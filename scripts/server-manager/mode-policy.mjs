const WEAPONS = [
  { weapon: 'weapon_ak47', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_m4a1', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_m4a1_silencer', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_galilar', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_famas', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_aug', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_sg556', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_awp', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_ssg08', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_g3sg1', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_scar20', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_mac10', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_mp9', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_mp7', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_mp5sd', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_ump45', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_p90', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_bizon', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_nova', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_xm1014', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_mag7', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_sawedoff', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_m249', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_negev', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_glock', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_hkp2000', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_usp_silencer', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_p250', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_tec9', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_fiveseven', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_cz75a', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_deagle', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_revolver', slot: 'secondary', category: 'pistols' },
];

const WEAPON_CATEGORIES = ['pistols', 'smgs', 'rifles', 'heavy'];
// Modes without an economy: the players get no money and no buy menu at all.
// A workshop map restores its own money/buy values on every spawn, so these
// modes are re-closed by the server manager after the map logic runs.
export const MONEY_LESS_MODES = new Set(['AWP_ONLY', 'DEAGLE_ONLY', 'KNIFE_ONLY', 'RANDOM_WEAPON', 'GRENADE_ONLY']);
export const FIRST_TO_10_KILLS = 10;

export function isMoneylessMode(mode, weaponModifier = null) {
  return MONEY_LESS_MODES.has(resolveEffectiveMode(mode, weaponModifier));
}

// Economy and shop closure for the money-less modes. mp_maxmoney 0 also clamps
// an already granted balance back to $0, so the money the workshop map hands
// out disappears on the next enforcement tick instead of staying spendable.
export function getMoneylessEconomyCommands() {
  return [
    'mp_maxmoney 0',
    'mp_startmoney 0',
    'mp_afterroundmoney 0',
    'mp_buytime 0',
    'mp_buy_anywhere 0',
    'mp_buy_during_immunity 0',
    'mp_buy_allow_guns 0',
    'mp_buy_allow_grenades 0',
    // Armor and helmet are granted for free at spawn because the shop cannot be
    // used in a money-less mode. Re-asserted on every tick so a map that resets
    // the cvar cannot strip it from the next spawn.
    'mp_free_armor 2',
  ];
}

// Removing the buy zone makes the stock CS2 answer "You left the buy zone"
// when B is pressed instead of opening the shop, exactly like a knife-only
// map without a buy zone.
export function getBuyZoneRemovalCommands() {
  return [
    'ent_fire func_buyzone kill',
    'ent_remove func_buyzone',
  ];
}

export function chooseRandomWeapon(random = Math.random) {
  const index = Math.floor(random() * WEAPONS.length);
  return WEAPONS[Math.max(0, Math.min(WEAPONS.length - 1, index))];
}

export function resolveEffectiveMode(mode, weaponModifier) {
  return weaponModifier && weaponModifier !== 'STANDARD' ? weaponModifier : mode;
}

// A first-connect restart is needed only for modes that must re-issue a
// mode-specific default weapon to an already-spawned player. Classic and
// HEADSHOT_ONLY use the normal arsenal, so restarting after the first connect
// only replays the workshop freeze/round-start sequence.
export function shouldRestartAfterFirstConnect(mode, weaponModifier = null) {
  const effectiveMode = resolveEffectiveMode(mode, weaponModifier);
  return effectiveMode !== 'SOLO_1V1' && effectiveMode !== 'HEADSHOT_ONLY';
}

export function buildDuelModeCommands(mode, weaponModifier = null, randomWeapon = null) {
  const effectiveMode = resolveEffectiveMode(mode, weaponModifier);
  const restricted = MONEY_LESS_MODES.has(effectiveMode);
  const grenadeOnly = effectiveMode === 'GRENADE_ONLY';
  const firstTo10 = effectiveMode === 'FIRST_TO_10';
  const headshotOnly = effectiveMode === 'HEADSHOT_ONLY';
  // FIRST_TO_10 is decided by kills, not round wins. Disable round clinching so a
  // 10-0 round lead cannot end the match before someone reaches 10 kills; the
  // 19-round limit remains the safety cap.
  const commands = [
    'mp_warmup_online_enabled 0', 'mp_warmuptime 0', 'mp_warmup_pausetimer 0', 'mp_warmup_end',
    'mp_autoteambalance 0', 'mp_limitteams 0', 'mp_freezetime 5',
    'mp_roundtime 2', 'mp_roundtime_defuse 2', 'mp_roundtime_hostage 2',
    `mp_match_can_clinch ${firstTo10 ? '0' : '1'}`, 'mp_maxrounds 19', 'mp_halftime 0', 'mp_match_end_restart 0',
    `mp_damage_headshot_only ${headshotOnly ? '1' : '0'}`,
    `mp_buytime ${restricted ? '0' : '15'}`,
    `mp_buy_anywhere ${restricted ? '0' : '1'}`,
    `mp_buy_allow_guns ${restricted ? '0' : '255'}`,
    `mp_buy_allow_grenades ${restricted ? '0' : '1'}`,
    `mp_buy_during_immunity ${restricted ? '0' : '1'}`,
    `mp_respawn_immunitytime ${restricted ? '0' : '5'}`,
    // GRENADE_ONLY respawns on death in the current round (the plugin re-issues only the
    // unthrown remainder); every other mode must explicitly reset this so a duel still ends
    // on elimination. Waves are always off so a respawn is immediate.
    `mp_respawn_on_death_t ${grenadeOnly ? '1' : '0'}`,
    `mp_respawn_on_death_ct ${grenadeOnly ? '1' : '0'}`,
    'mp_use_respawn_waves 0',
    // CS2 kicks a player after five suicides. GRENADE_ONLY intentionally allows repeated
    // self-damage deaths, so it disables the kick. Every other mode sets the value back to
    // the normal 1 so a GRENADE_ONLY match cannot leak mp_autokick 0 into the next mode.
    `mp_autokick ${grenadeOnly ? '0' : '1'}`,
    `mp_weapons_allow_map_placed ${restricted ? '0' : '1'}`,
    `mp_weapons_allow_pistols ${restricted ? '0' : '-1'}`,
    `mp_weapons_allow_smgs ${restricted ? '0' : '-1'}`,
    `mp_weapons_allow_rifles ${restricted ? '0' : '-1'}`,
    `mp_weapons_allow_heavy ${restricted ? '0' : '-1'}`,
    `mp_weapons_allow_zeus ${restricted ? '0' : '1'}`,
    `mp_require_gun_use_to_acquire ${restricted ? '0' : '0'}`,
    `sv_allow_ground_weapon_pickup ${restricted ? '0' : '1'}`,
    `mp_death_drop_gun ${restricted ? '0' : '1'}`,
    `mp_death_drop_grenade ${restricted ? '0' : '1'}`,
    `mp_t_default_melee ${grenadeOnly ? '0' : 'weapon_knife'}`,
    `mp_ct_default_melee ${grenadeOnly ? '0' : 'weapon_knife'}`,
    `mp_t_default_primary ${restricted ? '0' : 'weapon_ak47'}`,
    `mp_ct_default_primary ${restricted ? '0' : 'weapon_m4a1'}`,
    `mp_t_default_secondary ${restricted ? '0' : 'weapon_glock'}`,
    `mp_ct_default_secondary ${restricted ? '0' : 'weapon_hkp2000'}`,
    'mp_t_default_grenades 0', 'mp_ct_default_grenades 0',
    'mp_free_armor 0',
    `duelplay_grenade_only ${effectiveMode === 'GRENADE_ONLY' ? '1' : '0'}`,
  ];

  if (!restricted) {
    // Start each open-mode match with $10,000 and cap the wallet there. FIRST_TO_10
    // refills to that cap after every round; other open modes keep normal win/loss
    // round income instead of refilling the wallet.
    const afterRoundMoney = firstTo10 ? '10000' : '0';
    commands.push('mp_maxmoney 10000', 'mp_startmoney 10000', `mp_afterroundmoney ${afterRoundMoney}`);
  } else {
    // Every restricted mode, including GRENADE_ONLY, starts and stays at $0 so
    // the closed shop cannot be bypassed and no inherited server/map economy leaks in.
    commands.push('mp_maxmoney 0', 'mp_startmoney 0', 'mp_afterroundmoney 0');
  }

  if (effectiveMode === 'AWP_ONLY') {
    commands.push(
      'mp_weapons_allow_rifles -1', 'mp_t_default_primary weapon_awp', 'mp_ct_default_primary weapon_awp',
      'mp_free_armor 2',
    );
  } else if (effectiveMode === 'DEAGLE_ONLY') {
    commands.push(
      'mp_weapons_allow_pistols -1', 'mp_t_default_secondary weapon_deagle', 'mp_ct_default_secondary weapon_deagle',
      'mp_free_armor 2',
    );
  } else if (effectiveMode === 'KNIFE_ONLY') {
    commands.push('mp_t_default_melee weapon_knife', 'mp_ct_default_melee weapon_knife', 'mp_free_armor 2');
  } else if (effectiveMode === 'RANDOM_WEAPON') {
    const selected = WEAPONS.find((entry) => entry.weapon === randomWeapon?.weapon && entry.slot === randomWeapon?.slot)
      ?? chooseRandomWeapon();
    for (const category of WEAPON_CATEGORIES) {
      commands.push(`mp_weapons_allow_${category} ${selected.category === category ? '-1' : '0'}`);
    }
    if (selected.slot === 'primary') {
      commands.push(`mp_t_default_primary ${selected.weapon}`, `mp_ct_default_primary ${selected.weapon}`);
    } else {
      commands.push(`mp_t_default_secondary ${selected.weapon}`, `mp_ct_default_secondary ${selected.weapon}`);
    }
    commands.push('mp_free_armor 2');
  } else if (effectiveMode === 'GRENADE_ONLY') {
    commands.push(
      'ammo_grenade_limit_total 12', 'ammo_grenade_limit_default 3', 'ammo_grenade_limit_flashbang 3',
      'mp_respawnwavetime_t 0', 'mp_respawnwavetime_ct 0',
      // The grenade mode has no economy, so armor and helmet cannot be bought.
      // mp_free_armor 2 grants vest and helmet to every player on both CT and T
      // at spawn, without touching the shop.
      'mp_free_armor 2',
    );
  } else if (effectiveMode === 'SOLO_1V1' || effectiveMode === 'HEADSHOT_ONLY' || firstTo10) {
    for (const category of WEAPON_CATEGORIES) commands.push(`mp_weapons_allow_${category} -1`);
    commands.push('mp_weapons_allow_zeus 1', 'mp_free_armor 0');
  }

  return commands;
}

export function getRuleReapplyDelays(event) {
  return {
    GAME_COMMENCING: [50, 100, 250, 500],
    MATCH_START: [0, 100, 500],
    ROUND_START: [150, 1000, 2500, 5000],
    PLAYER_CONNECTED: [250, 750, 1500, 2500],
    SERVER_READY: [1500, 3000, 5000],
  }[event] ?? [];
}

function firstToTenKillEntries(players) {
  return Object.entries(players ?? {})
    .map(([steamId, player]) => ({
      steamId,
      kills: Number(player?.match_stats?.kills ?? player?.kills ?? 0),
    }))
    .filter((entry) => Number.isFinite(entry.kills))
    .sort((a, b) => b.kills - a.kills);
}

export function getFirstToTenKillsWinner(players) {
  const [top, second] = firstToTenKillEntries(players);
  if (!top || top.kills < FIRST_TO_10_KILLS) return null;
  if (second && second.kills === top.kills) return null;
  return top.steamId;
}

export function getFirstToTenKillsLeader(players) {
  const [top, second] = firstToTenKillEntries(players);
  if (!top || (second && second.kills === top.kills)) return null;
  return top.steamId;
}
