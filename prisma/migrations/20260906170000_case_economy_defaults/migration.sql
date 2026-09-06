-- Normalize the built-in case tables to a sustainable <=100% expected-value economy.
-- Only legacy rows are touched; custom/admin-edited rows are left intact.
UPDATE "DuelCaseItem" i
SET "weight" = CASE i."name"
  WHEN 'Pistol Core' THEN 72
  WHEN 'Emerald Fang' THEN 20
  WHEN 'Azure Strike' THEN 6
  WHEN 'Violet Pulse' THEN 1
  WHEN 'Gold Reaper' THEN 1
  ELSE i."weight" END
FROM "DuelCase" c
WHERE i."caseId" = c."id" AND c."slug" = 'starter'
  AND ((i."name"='Pistol Core' AND i."weight"=50 AND i."value"=0.5)
    OR (i."name"='Emerald Fang' AND i."weight"=28 AND i."value"=1.2)
    OR (i."name"='Azure Strike' AND i."weight"=14 AND i."value"=2.5)
    OR (i."name"='Violet Pulse' AND i."weight"=6 AND i."value"=5)
    OR (i."name"='Gold Reaper' AND i."weight"=2 AND i."value"=12));

UPDATE "DuelCaseItem" i
SET "weight" = CASE i."name"
  WHEN 'Emerald Fang' THEN 68
  WHEN 'Azure Strike' THEN 22
  WHEN 'Violet Pulse' THEN 7
  WHEN 'Gold Reaper' THEN 2
  WHEN 'Neon Wolf' THEN 1
  ELSE i."weight" END
FROM "DuelCase" c
WHERE i."caseId" = c."id" AND c."slug" = 'neon'
  AND ((i."name"='Emerald Fang' AND i."weight"=42 AND i."value"=1.5)
    OR (i."name"='Azure Strike' AND i."weight"=30 AND i."value"=3.5)
    OR (i."name"='Violet Pulse' AND i."weight"=18 AND i."value"=7)
    OR (i."name"='Gold Reaper' AND i."weight"=8 AND i."value"=15)
    OR (i."name"='Neon Wolf' AND i."weight"=2 AND i."value"=30));

UPDATE "DuelCaseItem" i
SET "weight" = CASE i."name"
  WHEN 'Azure Strike' THEN 65
  WHEN 'Violet Pulse' THEN 25
  WHEN 'Gold Reaper' THEN 9
  WHEN 'Neon Wolf' THEN 1
  ELSE i."weight" END
FROM "DuelCase" c
WHERE i."caseId" = c."id" AND c."slug" = 'premium'
  AND ((i."name"='Azure Strike' AND i."weight"=35 AND i."value"=5)
    OR (i."name"='Violet Pulse' AND i."weight"=35 AND i."value"=12)
    OR (i."name"='Gold Reaper' AND i."weight"=25 AND i."value"=28)
    OR (i."name"='Neon Wolf' AND i."weight"=5 AND i."value"=80));

UPDATE "DuelCaseItem" i
SET "value" = CASE i."name"
  WHEN 'Pumpkin Pistol' THEN 5
  WHEN 'Ghost AWP' THEN 12
  WHEN 'Witch Knife' THEN 30
  WHEN 'Halloween Dragon' THEN 70
  ELSE i."value" END,
    "weight" = CASE i."name"
  WHEN 'Pumpkin Pistol' THEN 70
  WHEN 'Ghost AWP' THEN 20
  WHEN 'Witch Knife' THEN 8
  WHEN 'Halloween Dragon' THEN 2
  ELSE i."weight" END
FROM "DuelCase" c
WHERE i."caseId" = c."id" AND c."slug" = 'halloween-case'
  AND ((i."name"='Pumpkin Pistol' AND i."weight"=50 AND i."value"=12)
    OR (i."name"='Ghost AWP' AND i."weight"=25 AND i."value"=30)
    OR (i."name"='Witch Knife' AND i."weight"=8 AND i."value"=75)
    OR (i."name"='Halloween Dragon' AND i."weight"=2 AND i."value"=150));
