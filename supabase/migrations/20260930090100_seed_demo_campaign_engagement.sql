-- Demo data for the Qualified Leads page: a Payables campaign sent to every
-- contact who doesn't already buy Payables, where 10 randomly chosen
-- recipients opened the email. Their engagement figures are random.

with campaign as (
  insert into public.campaigns (product_id, name, launched_at, is_demo)
  values ('p1', 'Payables launch (demo data)', now() - interval '7 days', true)
  returning id
)
insert into public.campaign_engagements (campaign_id, contact_id)
select campaign.id, contacts.id
from campaign, public.contacts
where not ('p1' = any(contacts.products));

with opened (email, opened_at, read_seconds, clicked_through, website_seconds) as (
  values
  ('ricardo.donnelly@pankow.example', now() - interval '72 hours', 199, false, 0),
  ('priya.rasmussen@retool.example', now() - interval '112 hours', 137, false, 0),
  ('lindsay.santoro@pendleton-usa.example', now() - interval '129 hours', 24, false, 0),
  ('sean.barlow@ruggable.example', now() - interval '138 hours', 239, true, 668),
  ('diane.marchetti@shielsexton.example', now() - interval '84 hours', 107, true, 424),
  ('paul.langford@launchdarkly.example', now() - interval '105 hours', 220, false, 0),
  ('wesley.yamada@postman.example', now() - interval '131 hours', 29, true, 47),
  ('julia.dubois@stonewallkitchen.example', now() - interval '141 hours', 89, true, 564),
  ('derek.navarro@herrs.example', now() - interval '138 hours', 43, true, 831),
  ('nicole.ramaswamy@fahertybrand.example', now() - interval '91 hours', 208, true, 315)
)
update public.campaign_engagements e
set email_opened = true,
    opened_at = opened.opened_at,
    read_seconds = opened.read_seconds,
    clicked_through = opened.clicked_through,
    website_seconds = opened.website_seconds
from opened, public.contacts c, public.campaigns camp
where c.email = opened.email
  and e.contact_id = c.id
  and e.campaign_id = camp.id
  and camp.is_demo;
