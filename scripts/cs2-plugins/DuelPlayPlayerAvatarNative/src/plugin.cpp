#include <ISmmPlugin.h>
#include <networkstringtabledefs.h>
#include <eiface.h>
#include <icvar.h>
#include <tier1/convar.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

PLUGIN_GLOBALVARS();

namespace
{
INetworkStringTableContainer* g_stringTables = nullptr;

void FormatSteamId(uint64_t steamId, char* buffer, size_t length)
{
    std::snprintf(buffer, length, "%llu",
                  static_cast<unsigned long long>(steamId));
}

bool EnsureReliableAvatarData()
{
    ConVarRefAbstract cvar("sv_reliableavatardata");

    if (!cvar.IsValidRef())
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] sv_reliableavatardata: invalid ref\n");
        return false;
    }

    if (!cvar.GetBool())
    {
        cvar.SetBool(true);

        if (!cvar.GetBool())
        {
            META_CONPRINTF("[DuelPlayPlayerAvatar] failed to enable sv_reliableavatardata\n");
            return false;
        }
    }

    return true;
}

bool ClearAvatarOverride(uint64_t steamId)
{
    if (!g_stringTables || steamId == 0)
        return false;

    INetworkStringTable* table =
        g_stringTables->FindTable("ServerAvatarOverrides");

    if (!table)
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] ServerAvatarOverrides table not found\n");
        return false;
    }

    char key[32];
    FormatSteamId(steamId, key, sizeof(key));

    const int index = table->FindStringIndex(key);

    if (index <= 0)
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] no avatar override for %s\n", key);
        return true;
    }

    SetStringUserDataRequest_t empty{};

    if (!table->SetStringUserData(index, &empty, true))
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] failed to clear avatar sid=%s index=%d\n",
                       key, index);
        return false;
    }

    META_CONPRINTF("[DuelPlayPlayerAvatar] cleared avatar sid=%s index=%d\n",
                   key, index);

    return true;
}

bool SetAvatarOverride(
    uint64_t steamId,
    const std::vector<unsigned char>& data)
{
    if (!g_stringTables || steamId == 0 || data.empty())
        return false;

    INetworkStringTable* table =
        g_stringTables->FindTable("ServerAvatarOverrides");

    if (!table)
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] ServerAvatarOverrides table not found\n");
        return false;
    }

    static constexpr unsigned char kPngSignature[8] = {
        0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a
    };

    if (data.size() < sizeof(kPngSignature) ||
        std::memcmp(data.data(), kPngSignature, sizeof(kPngSignature)) != 0)
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] rejected avatar: not a PNG\n");
        return false;
    }

    if (!EnsureReliableAvatarData())
        return false;

    if (table->GetNumStrings() == 0)
    {
        SetStringUserDataRequest_t empty{};
        const int sentinel =
            table->AddString(true, "__duelplay_no_avatar__", &empty);

        if (sentinel != 0)
        {
            META_CONPRINTF("[DuelPlayPlayerAvatar] failed to reserve table index 0\n");
            return false;
        }
    }

    char key[32];
    FormatSteamId(steamId, key, sizeof(key));

    SetStringUserDataRequest_t userData{};
    userData.m_pRawData =
        const_cast<unsigned char*>(data.data());
    userData.m_cbDataSize =
        static_cast<unsigned int>(data.size());

    int index = table->FindStringIndex(key);

    if (index == 0)
    {
        META_CONPRINTF("[DuelPlayPlayerAvatar] refusing reserved index 0\n");
        return false;
    }

    if (index < 0)
    {
        index = table->AddString(true, key, &userData);

        if (index <= 0)
        {
            META_CONPRINTF("[DuelPlayPlayerAvatar] failed to add avatar sid=%s\n", key);
            return false;
        }
    }
    else
    {
        if (!table->SetStringUserData(index, &userData, true))
        {
            META_CONPRINTF(
                "[DuelPlayPlayerAvatar] failed to update avatar sid=%s index=%d\n",
                key, index);
            return false;
        }
    }

    META_CONPRINTF(
        "[DuelPlayPlayerAvatar] applied avatar sid=%s bytes=%zu index=%d\n",
        key, data.size(), index);

    return true;
}

bool LoadPngFile(const char* path, std::vector<unsigned char>& data)
{
    if (!path || !*path)
        return false;

    std::ifstream file(path, std::ios::binary | std::ios::ate);

    if (!file.is_open())
        return false;

    const std::streamsize size = file.tellg();

    if (size <= 0 || size > 512 * 1024)
        return false;

    file.seekg(0, std::ios::beg);

    data.resize(static_cast<size_t>(size));

    if (!file.read(
            reinterpret_cast<char*>(data.data()),
            size))
    {
        data.clear();
        return false;
    }

    return true;
}

bool ParseSteamId(const char* text, uint64_t& steamId)
{
    if (!text || !*text)
        return false;

    char* end = nullptr;
    const unsigned long long value =
        std::strtoull(text, &end, 10);

    if (!end || *end != '\0' || value == 0)
        return false;

    steamId = static_cast<uint64_t>(value);
    return true;
}

CON_COMMAND_F(
    duelplay_set_player_avatar,
    "DuelPlay: apply PNG avatar to SteamID64",
    FCVAR_GAMEDLL)
{
    if (args.ArgC() < 3)
    {
        META_CONPRINTF(
            "[DuelPlayPlayerAvatar] usage: duelplay_set_player_avatar <steamid64> <png_path>\n");
        return;
    }

    uint64_t steamId = 0;

    if (!ParseSteamId(args.Arg(1), steamId))
    {
        META_CONPRINTF(
            "[DuelPlayPlayerAvatar] invalid SteamID64: %s\n",
            args.Arg(1));
        return;
    }

    std::vector<unsigned char> data;

    if (!LoadPngFile(args.Arg(2), data))
    {
        META_CONPRINTF(
            "[DuelPlayPlayerAvatar] failed to read PNG: %s\n",
            args.Arg(2));
        return;
    }

    SetAvatarOverride(steamId, data);
}

CON_COMMAND_F(
    duelplay_clear_player_avatar,
    "DuelPlay: clear PNG avatar override for SteamID64",
    FCVAR_GAMEDLL)
{
    if (args.ArgC() < 2)
    {
        META_CONPRINTF(
            "[DuelPlayPlayerAvatar] usage: duelplay_clear_player_avatar <steamid64>\n");
        return;
    }

    uint64_t steamId = 0;

    if (!ParseSteamId(args.Arg(1), steamId))
    {
        META_CONPRINTF(
            "[DuelPlayPlayerAvatar] invalid SteamID64: %s\n",
            args.Arg(1));
        return;
    }

    ClearAvatarOverride(steamId);
}
}

class DuelPlayPlayerAvatar final
    : public ISmmPlugin
    , public IMetamodListener
{
public:
    bool Load(
        PluginId id,
        ISmmAPI* ismm,
        char* error,
        size_t maxlen,
        bool late) override;

    bool Unload(
        char* error,
        size_t maxlen) override;

    const char* GetAuthor() override
    {
        return "DuelPlay";
    }

    const char* GetName() override
    {
        return "DuelPlay Player Avatar";
    }

    const char* GetDescription() override
    {
        return "DuelPlay CS2 player avatar override";
    }

    const char* GetURL() override
    {
        return "https://duelplaygame.com";
    }

    const char* GetLicense() override
    {
        return "Proprietary";
    }

    const char* GetVersion() override
    {
        return "1.0.0";
    }

    const char* GetDate() override
    {
        return __DATE__;
    }

    const char* GetLogTag() override
    {
        return "DuelPlayPlayerAvatar";
    }

    void OnLevelInit(
        char const*,
        char const*,
        char const*,
        char const*,
        bool,
        bool) override {}

    void OnLevelShutdown() override
    {
        g_stringTables = nullptr;
    }
};

DuelPlayPlayerAvatar g_DuelPlayPlayerAvatar;

PLUGIN_EXPOSE(
    DuelPlayPlayerAvatar,
    g_DuelPlayPlayerAvatar);

bool DuelPlayPlayerAvatar::Load(
    PluginId id,
    ISmmAPI* ismm,
    char* error,
    size_t maxlen,
    bool late)
{
    PLUGIN_SAVEVARS();

    g_stringTables =
        static_cast<INetworkStringTableContainer*>(
            ismm->GetEngineFactory()(
                INTERFACENAME_NETWORKSTRINGTABLESERVER,
                nullptr));

    if (!g_stringTables)
    {
        std::snprintf(
            error,
            maxlen,
            "Failed to acquire network string table interface");

        return false;
    }

    g_pCVar = static_cast<ICvar*>(
        ismm->GetEngineFactory()(
            CVAR_INTERFACE_VERSION,
            nullptr));

    if (!g_pCVar)
    {
        std::snprintf(
            error,
            maxlen,
            "Failed to acquire ICvar interface");

        return false;
    }

    META_CONVAR_REGISTER(
        FCVAR_RELEASE |
        FCVAR_GAMEDLL);

    g_SMAPI->AddListener(
        this,
        this);

    META_CONPRINTF(
        "[DuelPlayPlayerAvatar] Loaded, ServerAvatarOverrides=%s\n",
        g_stringTables->FindTable("ServerAvatarOverrides")
            ? "available"
            : "not yet available");

    return true;
}

bool DuelPlayPlayerAvatar::Unload(
    char* error,
    size_t maxlen)
{
    g_stringTables = nullptr;
    return true;
}
