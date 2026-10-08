-- CreateTable
CREATE TABLE "AdminRoleAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "roleCode" VARCHAR(32) NOT NULL,
    "level" INTEGER NOT NULL,
    "permissionOverrides" JSONB,
    "assignedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminRoleAssignment_userId_key" ON "AdminRoleAssignment"("userId");

-- CreateIndex
CREATE INDEX "AdminRoleAssignment_roleCode_idx" ON "AdminRoleAssignment"("roleCode");

-- CreateIndex
CREATE INDEX "AdminRoleAssignment_level_idx" ON "AdminRoleAssignment"("level");

-- CreateIndex
CREATE INDEX "AdminRoleAssignment_assignedBy_idx" ON "AdminRoleAssignment"("assignedBy");

-- AddForeignKey
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
