import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.game.upsert({
    where: { slug: "cs2" },
    update: {},
    create: {
      slug: "cs2",
      title: "Counter-Strike 2",
      isEnabled: true,
      config: {},
    },
  });

  await prisma.user.upsert({
    where: { nickname: "TestPlayer" },
    update: {},
    create: {
      steamId: "TEST_STEAM_ID",
      nickname: "TestPlayer",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      referralCode: "TEST001",
    },
  });

  console.log("✅ Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });