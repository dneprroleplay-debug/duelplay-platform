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
const CLOSED_MODES = new Set(['AWP_ONLY', 'DEAGLE_ONLY', 'KNIFE_ONLY', 'RANDOM_WEAPON', 'GRENADE_ONLY']);

export function chooseRandomWeapon(random = Math.random) {
  const index = Math.floor(random() * WEAPONS.length);
  return WEAPONS[Math.max(0, Math.min(WEAPONS.length - 1, index))];
}

export function resolveEffectiveMode(mode, weaponModifier) {
  return weaponModifier && weaponModifier !== 'STANDARD' ? weaponModifier : mode;
}

export function buildDuelModeCommands(mode, weaponModifier = null, randomWeapon = null) {
  const effectiveMode = resolveEffectiveMode(mode, weaponModifier);
  const restricted = CLOSED_MODES.has(effectiveMode);
  const grenadeOnly = effectiveMode === 'GRENADE_ONLY';
  const firstTo10 = effectiveMode === 'FIRST_TO_10';
  const headshotOnly = effectiveMode === 'HEADSHOT_ONLY';
  const commands = [
    'mp_warmup_online_enabled 0', 'mp_warmuptime 0', 'mp_warmup_pausetimer 0', 'mp_warmup_end',
    'mp_autoteambalance 0', 'mp_limitteams 0', 'mp_freezetime 5',
    'mp_roundtime 2', 'mp_roundtime_defuse 2', 'mp_roundtime_hostage 2',
    'mp_match_can_clinch 1', 'mp_maxrounds 19', 'mp_halftime 0', 'mp_match_end_restart 0',
    `mp_damage_headshot_only ${headshotOnly ? '1' : '0'}`,
    `mp_buytime ${restricted ? '0' : '35'}`,
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

  if (!restricted) commands.push('mp_startmoney 16000', 'mp_maxmoney 16000', 'mp_afterroundmoney 16000');

  if (firstTo10) commands.push('mp_maxrounds 19', 'mp_match_can_clinch 1', 'mp_halftime 0');

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

export function getFirstToTenWinnerTeam(ctScore, tScore) {
  const ct = Number(ctScore);
  const t = Number(tScore);
  if (!Number.isFinite(ct) || !Number.isFinite(t) || (ct < 10 && t < 10)) return null;
  if (ct === t) return null;
  return ct > t ? 'CT' : 'T';
}
