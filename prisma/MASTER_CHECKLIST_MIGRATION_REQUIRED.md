# Master checklist schema migration

The v30 schema adds the MASTER CHECKLIST data model. A real PostgreSQL migration must be generated against the deployment database with the project's pinned Prisma version before `prisma migrate deploy`.

Recommended:

```bash
npx prisma migrate dev --name master_checklist_foundation
npx prisma migrate deploy
```

Do not hand-edit production data or drop the database. The v29 migrations remain untouched.
