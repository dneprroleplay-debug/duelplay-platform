using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;

namespace DuelPlayPlayerName;

[MinimumApiVersion(80)]
public sealed class DuelPlayPlayerName : BasePlugin
{
    public override string ModuleName => "DuelPlay Player Name";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Sets DuelPlay player nicknames in CS2.";

    [ConsoleCommand("duelplay_set_player_name", "Set a connected player's CS2 nickname.")]
    [CommandHelper(minArgs: 2, usage: "<steamid> <nickname>", whoCanExecute: CommandUsage.SERVER_ONLY)]
    public void OnSetPlayerName(CCSPlayerController? caller, CommandInfo command)
    {
        if (command.ArgCount < 3)
        {
            command.ReplyToCommand("Usage: duelplay_set_player_name <steamid> <nickname>");
            return;
        }

        var steamIdText = command.GetArg(1);

        if (!ulong.TryParse(steamIdText, out var steamId))
        {
            command.ReplyToCommand("Invalid SteamID.");
            return;
        }

        var nickname = string.Join(
            " ",
            Enumerable.Range(2, command.ArgCount - 2)
                .Select(command.GetArg)
        ).Trim();

        if (string.IsNullOrWhiteSpace(nickname))
        {
            command.ReplyToCommand("Nickname cannot be empty.");
            return;
        }

        var player = Utilities.GetPlayers()
            .FirstOrDefault(p =>
                p.IsValid &&
                !p.IsBot &&
                p.SteamID == steamId
            );

        if (player is null)
        {
            command.ReplyToCommand($"Player {steamId} is not connected.");
            return;
        }

        player.PlayerName = nickname;

        command.ReplyToCommand(
            $"DuelPlay nickname set: {steamId} -> {nickname}"
        );

    }
}





