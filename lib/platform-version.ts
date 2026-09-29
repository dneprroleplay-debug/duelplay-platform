import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

const ADMIN_ROLES: UserRole[] = [
  "SUPPORT",
  "MODERATOR",
  "ADMIN",
  "SUPERADMIN",
];

export async function getPlatformVersion() {
  const latest = await prisma.auditLog.findFirst({
    where: {
      user: {
        role: {
          in: ADMIN_ROLES,
        },
      },
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      createdAt: true,
    },
  });

  return latest
    ? `${latest.createdAt.toISOString()}-${latest.id}`
    : "0";
}
