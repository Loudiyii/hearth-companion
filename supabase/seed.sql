-- Demo data: elder "Marie", approver "Claire", a 14-item catalog priced in cents,
-- and a usual_list for marie that totals exactly 8400 cents — 2400 cents over
-- the 6000-cent weekly budget, so the demo hits the approval path.

insert into elders (id, display_name, telegram_chat_id)
values ('marie', 'Marie', null)
on conflict (id) do nothing;

insert into approvers (id, elder_id, display_name, telegram_chat_id)
values ('claire', 'marie', 'Claire', 'REPLACE_ME')
on conflict (id) do nothing;

insert into budgets (elder_id, weekly_limit_cents)
values ('marie', 6000)
on conflict (elder_id) do update set weekly_limit_cents = excluded.weekly_limit_cents;

insert into catalog (sku, name, unit_cents) values
  ('milk', 'Milk', 150),
  ('eggs', 'Eggs', 320),
  ('bread', 'Bread', 250),
  ('butter', 'Butter', 380),
  ('cheese', 'Cheese', 550),
  ('chicken', 'Chicken', 890),
  ('rice', 'Rice', 320),
  ('pasta', 'Pasta', 180),
  ('tomatoes', 'Tomatoes', 300),
  ('bananas', 'Bananas', 220),
  ('apples', 'Apples', 340),
  ('coffee', 'Coffee', 650),
  ('yogurt', 'Yogurt', 400),
  ('orange_juice', 'Orange Juice', 350)
on conflict (sku) do update set name = excluded.name, unit_cents = excluded.unit_cents;

-- Usual list for marie — over budget by design.
-- bananas 3 * 220 =  660
-- chicken 3 * 890 = 2670
-- cheese  2 * 550 = 1100
-- orange_juice 2 * 350 = 700
-- apples  3 * 340 = 1020
-- butter  3 * 380 = 1140
-- bread   3 * 250 =  750
-- pasta   2 * 180 =  360
-- total                = 660+2670+1100+700+1020+1140+750+360 = 8400 cents
insert into usual_list (elder_id, sku, qty) values
  ('marie', 'bananas', 3),
  ('marie', 'chicken', 3),
  ('marie', 'cheese', 2),
  ('marie', 'orange_juice', 2),
  ('marie', 'apples', 3),
  ('marie', 'butter', 3),
  ('marie', 'bread', 3),
  ('marie', 'pasta', 2)
on conflict (elder_id, sku) do update set qty = excluded.qty;
