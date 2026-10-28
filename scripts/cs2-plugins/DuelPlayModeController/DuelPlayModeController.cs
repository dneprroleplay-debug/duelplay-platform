using System.Text.Json;
using System.Text.Json.Nodes;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Utils;

namespace DuelPlayModeController;

[MinimumApiVersion(80)]
public sealed class DuelPlayModeController : BasePlugin
{
    public const string ControllerVersion = "1.0.0";
    public static readonly string[] Capabilities =
    {
        "BASE_CONFIG",
        "LOW_GRAVITY",
        "SPEED_DUEL",
        "GRENADE_COOLDOWN",
    };

    private static readonly HashSet<int> ApprovedGravityPercents = new() { 20, 40, 50, 60, 70, 80, 100 };
    private static readonly HashSet<int> ApprovedSpeedPercents = new() { 110, 120, 130, 140, 150 };
    private const int MinimumSafeGravityPercent = 60;

    private readonly object _gate = new();
    private readonly Dictionary<string, double> _grenadeCooldowns = new(StringComparer.OrdinalIgnoreCase);
    private string? _gameRoot;
    private string? _lastStateJson;
    private long _roundGeneration;
    private bool _grenadeCooldownEnabled;
    private double _defaultGrenadeCooldownSeconds;

    public override string ModuleName => "DuelPlay Mode Controller";
    public override string ModuleVersion => ControllerVersion;
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Validates, applies and reports the DuelPlay advanced game-mode configuration.";

    private string GameRoot => _gameRoot ??= ResolveGameRoot();
    private string MatchFile => Path.Combine(GameRoot, "csgo", "cfg", "duelplay-match-mode.json");
    private string StateFile => Path.Combine(GameRoot, "csgo", "cfg", "duelplay-mode-controller-state.json");

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnMapStart>(_ => ApplyMatchConfig("map-start"));
        RegisterEventHandler<EventRoundStart>((_, _) =>
        {
            ApplyMatchConfig("round-start");
            return HookResult.Continue;
        });
        RegisterEventHandler<EventGrenadeThrown>((@event, _) =>
        {
            OnGrenadeThrown(@event);
            return HookResult.Continue;
        });
        AddCommand("duelplay_mode_status", "Prints the DuelPlay mode-controller state.", (_, _) =>
        {
            ApplyMatchConfig("status-command");
            Server.PrintToConsole(ReadStateText());
        });

        Server.NextFrame(() => ApplyMatchConfig("plugin-load"));
        Server.PrintToConsole($"DuelPlay mode controller {ControllerVersion} loaded with capabilities {string.Join(",", Capabilities)}");
    }

    public override void Unload(bool hotReload)
    {
        _grenadeCooldownEnabled = false;
        _grenadeCooldowns.Clear();
    }

    private string ResolveGameRoot()
    {
        var directory = Path.GetDirectoryName(ModulePath);
        while (!string.IsNullOrEmpty(directory))
        {
            var info = new DirectoryInfo(directory);
            if (string.Equals(info.Name, "csgo", StringComparison.OrdinalIgnoreCase))
            {
                return info.Parent?.FullName ?? throw new InvalidOperationException("CS2 root is unavailable.");
            }
            directory = info.Parent?.FullName;
        }
        throw new InvalidOperationException("Could not locate the csgo directory from the plugin path.");
    }

    private void ApplyMatchConfig(string reason)
    {
        lock (_gate)
        {
            _grenadeCooldownEnabled = false;
            _grenadeCooldowns.Clear();
            _roundGeneration++;

            try
            {
                if (!File.Exists(MatchFile))
                {
                    WriteState(false, "MATCH_CONFIG_MISSING", null, null, null, null, reason);
                    return;
                }

                var match = JsonNode.Parse(File.ReadAllText(MatchFile)) as JsonObject
                    ?? throw new InvalidDataException("MATCH_CONFIG_INVALID");
                if (match["schemaVersion"]?.GetValue<int>() != 1) throw new InvalidDataException("MATCH_CONFIG_INVALID");

                var mode = match["mode"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(mode))
                {
                    ResetNeutralCvars();
                    WriteState(true, "NO_ACTIVE_MATCH", null, null, null, null, reason);
                    return;
                }

                var mapId = match["mapId"]?.GetValue<string>() ?? throw new InvalidDataException("MATCH_MAP_MISSING");
                var configVersion = match["configVersion"] is JsonValue versionNode ? versionNode.GetValue<int>() : (int?)null;
                var configChecksum = match["configChecksum"]?.GetValue<string>();
                if (match["enabled"]?.GetValue<bool>() != true) throw new InvalidDataException("MODE_DISABLED");
                var allowedMapIds = match["allowedMapIds"] as JsonArray;
                if (allowedMapIds is not null && !allowedMapIds.Any(node => string.Equals(node?.GetValue<string>(), mapId, StringComparison.Ordinal)))
                {
                    throw new InvalidDataException("MODE_MAP_NOT_ALLOWED");
                }

                var settings = match["settings"] as JsonObject ?? new JsonObject();
                var applied = new Dictionary<string, object?>();
                switch (mode)
                {
                    case "LOW_GRAVITY":
                    {
                        var percent = ResolveMapValue(settings, "gravityPercentByMap", mapId, "gravityPercent");
                        if (!ApprovedGravityPercents.Contains(percent) || percent < MinimumSafeGravityPercent)
                        {
                            throw new InvalidDataException("UNSAFE_GRAVITY_SETTINGS");
                        }
                        var gravity = (int)Math.Round(800 * percent / 100.0, MidpointRounding.AwayFromZero);
                        Server.ExecuteCommand($"sv_gravity {gravity}");
                        applied["gravityPercent"] = percent;
                        applied["sv_gravity"] = gravity;
                        break;
                    }
                    case "SPEED_DUEL":
                    {
                        var percent = ReadInt(settings, "speedPercent");
                        if (!ApprovedSpeedPercents.Contains(percent)) throw new InvalidDataException("UNSAFE_SPEED_SETTINGS");
                        var speed = (int)Math.Round(320 * percent / 100.0, MidpointRounding.AwayFromZero);
                        Server.ExecuteCommand($"sv_maxspeed {speed}");
                        Server.ExecuteCommand("sv_accelerate_use_weapon_speed 0");
                        applied["speedPercent"] = percent;
                        applied["sv_maxspeed"] = speed;
                        break;
                    }
                    case "GRENADE_ONLY":
                        ConfigureGrenadeCooldown(settings);
                        applied["replenishmentMode"] = _grenadeCooldownEnabled ? "COOLDOWN" : "ROUND_QUOTA";
                        break;
                    default:
                        ResetNeutralCvars();
                        applied["neutralCvars"] = true;
                        break;
                }

                WriteState(true, null, mode, mapId, configVersion, configChecksum, reason, applied);
                Server.PrintToConsole($"DuelPlay mode controller applied {mode} on {mapId} from config v{configVersion?.ToString() ?? "legacy"} ({reason})");
            }
            catch (Exception error)
            {
                _grenadeCooldownEnabled = false;
                _grenadeCooldowns.Clear();
                WriteState(false, error.Message, null, null, null, null, reason);
                Server.PrintToConsole($"DuelPlay mode controller did not apply config: {error.Message}");
            }
        }
    }

    private static int ReadInt(JsonObject node, string key)
    {
        return node[key]?.GetValue<int>() ?? throw new InvalidDataException($"MODE_SETTINGS_INVALID:{key}");
    }

    private static int ResolveMapValue(JsonObject settings, string byMapKey, string mapId, string defaultValueKey)
    {
        if (settings[byMapKey] is JsonObject byMap && byMap[mapId] is JsonNode mapValue)
        {
            return mapValue.GetValue<int>();
        }
        return ReadInt(settings, defaultValueKey);
    }

    private void ResetNeutralCvars()
    {
        Server.ExecuteCommand("sv_gravity 800");
        Server.ExecuteCommand("sv_maxspeed 320");
        Server.ExecuteCommand("sv_accelerate_use_weapon_speed 1");
    }

    private void ConfigureGrenadeCooldown(JsonObject settings)
    {
        if (!string.Equals(settings["replenishmentMode"]?.GetValue<string>(), "COOLDOWN", StringComparison.OrdinalIgnoreCase)) return;
        var defaultCooldown = ReadInt(settings, "defaultCooldownSeconds");
        if (defaultCooldown < 1 || defaultCooldown > 30) throw new InvalidDataException("GRENADE_COOLDOWN_INVALID");

        var grenades = settings["grenades"] as JsonArray ?? throw new InvalidDataException("GRENADE_LIST_INVALID");
        var configured = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in grenades.OfType<JsonObject>())
        {
            if (entry["enabled"]?.GetValue<bool>() != true) continue;
            var type = entry["type"]?.GetValue<string>() ?? throw new InvalidDataException("GRENADE_TYPE_INVALID");
            var cooldown = entry["cooldownSeconds"] is JsonNode cooldownNode && cooldownNode.GetValueKind() != JsonValueKind.Null
                ? cooldownNode.GetValue<double>()
                : defaultCooldown;
            if (!double.IsFinite(cooldown) || cooldown < 1 || cooldown > 30) throw new InvalidDataException("GRENADE_COOLDOWN_INVALID");
            configured[type] = cooldown;
        }
        if (configured.Count == 0) throw new InvalidDataException("GRENADE_LIST_INVALID");

        _defaultGrenadeCooldownSeconds = defaultCooldown;
        foreach (var pair in configured) _grenadeCooldowns[pair.Key] = pair.Value;
        _grenadeCooldownEnabled = true;
    }

    private void OnGrenadeThrown(EventGrenadeThrown @event)
    {
        if (!_grenadeCooldownEnabled) return;
        var player = @event.Userid;
        var weapon = @event.Weapon;
        if (player is null || !player.IsValid || string.IsNullOrWhiteSpace(weapon)) return;

        var type = GrenadeTypeFromClassname(weapon);
        if (type is null) return;
        var cooldown = _grenadeCooldowns.TryGetValue(type, out var configured) ? configured : _defaultGrenadeCooldownSeconds;
        var roundGeneration = _roundGeneration;
        AddTimer((float)cooldown, () =>
        {
            if (roundGeneration != _roundGeneration || player is null || !player.IsValid) return;
            var classname = GrenadeClassname(type, player.Team);
            if (!string.IsNullOrEmpty(classname)) player.GiveNamedItem(classname);
        });
    }

    private static string? GrenadeTypeFromClassname(string classname)
    {
        return classname switch
        {
            "weapon_hegrenade" => "HE",
            "weapon_flashbang" => "FLASH",
            "weapon_smokegrenade" => "SMOKE",
            "weapon_molotov" or "weapon_incgrenade" => "INCENDIARY",
            "weapon_decoy" => "DECOY",
            _ => null,
        };
    }

    private static string? GrenadeClassname(string type, CsTeam team)
    {
        return type switch
        {
            "HE" => "weapon_hegrenade",
            "FLASH" => "weapon_flashbang",
            "SMOKE" => "weapon_smokegrenade",
            "INCENDIARY" => team == CsTeam.Terrorist ? "weapon_molotov" : "weapon_incgrenade",
            "DECOY" => "weapon_decoy",
            _ => null,
        };
    }

    private void WriteState(bool applied, string? error, string? mode, string? mapId, int? configVersion, string? configChecksum, string? reason, Dictionary<string, object?>? settings = null)
    {
        var state = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1,
            ["controllerVersion"] = ControllerVersion,
            ["capabilities"] = Capabilities,
            ["applied"] = applied,
            ["error"] = error,
            ["mode"] = mode,
            ["mapId"] = mapId,
            ["configVersion"] = configVersion,
            ["configChecksum"] = configChecksum,
            ["settings"] = settings ?? new Dictionary<string, object?>(),
            ["reason"] = reason,
            ["writtenAt"] = DateTimeOffset.UtcNow.ToString("O"),
        };
        var json = JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true });
        _lastStateJson = json;
        try
        {
            var directory = Path.GetDirectoryName(StateFile)!;
            Directory.CreateDirectory(directory);
            var temporary = $"{StateFile}.{Environment.ProcessId}.tmp";
            File.WriteAllText(temporary, json);
            File.Move(temporary, StateFile, true);
        }
        catch (Exception errorWriting)
        {
            Server.PrintToConsole($"Could not write DuelPlay mode-controller state: {errorWriting.Message}");
        }
    }

    private string ReadStateText()
    {
        if (!string.IsNullOrEmpty(_lastStateJson)) return _lastStateJson;
        try
        {
            return File.Exists(StateFile) ? File.ReadAllText(StateFile) : "{}";
        }
        catch
        {
            return "{}";
        }
    }
}
