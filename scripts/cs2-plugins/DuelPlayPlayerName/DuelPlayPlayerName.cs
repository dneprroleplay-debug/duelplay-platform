using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;
using System.Runtime.InteropServices;

namespace DuelPlayPlayerName;

[MinimumApiVersion(80)]
public sealed class DuelPlayPlayerName : BasePlugin
{
    private readonly Dictionary<ulong, string> _pendingNames = new();
    private readonly HashSet<nint> _nameBuffers = new();

    private MemoryFunctionWithReturn<nint, nint, nint, nint, nint, nint, nint, int, bool, nint>? ConnectClientFunc;

    private const string ConnectClientSignature =
        "55 48 89 E5 41 57 49 89 D7 41 56 49 89 FE 41 55 41 54 53 89 CB 48 81 EC ? ? ? ? 8B 45 20";

    public override string ModuleName => "DuelPlay Player Name";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Synchronizes DuelPlay nickname to the CS2 player name.";

    public override void Load(bool hotReload)
    {
        try
        {
            var ptr = NativeAPI.FindSignature(Addresses.EnginePath, ConnectClientSignature);

            Console.WriteLine($"[DuelPlayPlayerName] EnginePath: {Addresses.EnginePath}");
            Console.WriteLine($"[DuelPlayPlayerName] ConnectClient scan: 0x{ptr.ToInt64():X}");

            if (ptr == nint.Zero)
            {
                Console.WriteLine("[DuelPlayPlayerName] ConnectClient signature not found");
                return;
            }

            ConnectClientFunc = new MemoryFunctionWithReturn<nint, nint, nint, nint, nint, nint, nint, int, bool, nint>(
                ConnectClientSignature,
                Addresses.EnginePath
            );

            ConnectClientFunc.Hook(OnConnectClient, HookMode.Pre);

            Console.WriteLine("[DuelPlayPlayerName] ConnectClient hook installed");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[DuelPlayPlayerName] Load error: {ex}");
        }
    }

    public override void Unload(bool hotReload)
    {
        if (ConnectClientFunc != null)
        {
            try
            {
                ConnectClientFunc.Unhook(OnConnectClient, HookMode.Pre);
            }
            catch
            {
            }
        }

        foreach (var buffer in _nameBuffers)
        {
            if (buffer != nint.Zero)
                Marshal.FreeCoTaskMem(buffer);
        }

        _nameBuffers.Clear();
    }

    private HookResult OnConnectClient(DynamicHook hook)
    {
        var authTicketPtr = hook.GetParam<nint>(6);
        var authTicketLength = hook.GetParam<int>(7);

        if (authTicketPtr == nint.Zero || authTicketLength < 8)
            return HookResult.Continue;

        var steamId = unchecked((ulong)Marshal.ReadInt64(authTicketPtr));

        if (!_pendingNames.TryGetValue(steamId, out var nickname))
            return HookResult.Continue;

        var utf8Length = System.Text.Encoding.UTF8.GetByteCount(nickname);

        if (utf8Length >= 128)
            return HookResult.Continue;

        var buffer = Marshal.StringToCoTaskMemUTF8(nickname);
        _nameBuffers.Add(buffer);

        hook.SetParam(1, buffer);

        Console.WriteLine(
            $"[DuelPlayPlayerName] ConnectClient name override: {steamId} -> {nickname}"
        );

        return HookResult.Continue;
    }

    [ConsoleCommand("duelplay_set_player_name", "Set a connected player's DuelPlay nickname.")]
    [CommandHelper(minArgs: 2, usage: "<steamid> <nickname>", whoCanExecute: CommandUsage.SERVER_ONLY)]
    public void OnSetPlayerName(CCSPlayerController? caller, CommandInfo command)
    {
        if (command.ArgCount < 3)
        {
            command.ReplyToCommand("Usage: duelplay_set_player_name <steamid> <nickname>");
            return;
        }

        if (!ulong.TryParse(command.GetArg(1), out var steamId))
        {
            Console.WriteLine($"[DuelPlayPlayerName] invalid SteamID: {command.GetArg(1)}");
            return;
        }

        var nickname = command.GetArg(2);
        _pendingNames[steamId] = nickname;

        var player = Utilities.GetPlayers().FirstOrDefault(p =>
            p.IsValid && !p.IsBot && p.SteamID == steamId);

        if (player is not null)
        {
            ApplyName(player, nickname);
        }
        else
        {
            Console.WriteLine($"[DuelPlayPlayerName] waiting for ConnectFull: {steamId} -> {nickname}");
        }
    }

    [ListenerHandler<Listeners.OnClientPutInServer>]
    public void OnClientPutInServer(int playerSlot)
    {
        var player = Utilities.GetPlayerFromSlot(playerSlot);

        if (player is null || !player.IsValid || player.IsBot)
            return;

        if (!_pendingNames.TryGetValue(player.SteamID, out var nickname))
            return;

        ApplyName(player, nickname);

        AddTimer(0.10f, () =>
        {
            if (player.IsValid)
                ApplyName(player, nickname);
        }, TimerFlags.STOP_ON_MAPCHANGE);

        AddTimer(0.50f, () =>
        {
            if (player.IsValid)
                ApplyName(player, nickname);
        }, TimerFlags.STOP_ON_MAPCHANGE);
    }

    [GameEventHandler]
    public HookResult OnPlayerConnectFull(EventPlayerConnectFull @event, GameEventInfo info)
    {
        var player = @event.Userid;

        if (player is null || !player.IsValid || player.IsBot)
            return HookResult.Continue;

        if (_pendingNames.TryGetValue(player.SteamID, out var nickname))
        {
            ApplyName(player, nickname);

            Server.NextFrame(() =>
            {
                if (player.IsValid)
                    ApplyName(player, nickname);
            });
        }

        return HookResult.Continue;
    }

    private static void ApplyName(CCSPlayerController player, string nickname)
    {
        player.PlayerName = nickname;

        Utilities.SetStateChanged(
            player,
            "CBasePlayerController",
            "m_iszPlayerName"
        );

        Console.WriteLine(
            $"[DuelPlayPlayerName] player name applied: {player.SteamID} -> {nickname}"
        );
    }
}
