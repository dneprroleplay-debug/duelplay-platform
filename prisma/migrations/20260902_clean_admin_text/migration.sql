UPDATE "Transaction"
SET description = convert_from(convert_to(description, 'WIN1251'), 'UTF8')
WHERE description LIKE '%Рђ%' OR description LIKE '%Рќ%' OR description LIKE '%Р’%' OR description LIKE '%РЎ%';
