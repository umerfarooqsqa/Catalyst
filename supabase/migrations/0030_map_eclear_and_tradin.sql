-- Two more automated houses, installed on the test phone and confirmed with aapt:
--   com.catalyst.nxgeclear  'Eclear NxG Tick'  v0.50.607 -> existing 'Eclear' project (two identical empty duplicates
--                                                            exist; the older one is mapped, the other left as is)
--   com.catalyst.tradin     'Tradin One'       v1.0.5     -> no matching project existed, so a new Android project is created
update public.projects
   set house_slug = 'nxgeclear', house_group = 'nxgeclear', current_version = '0.50.607'
 where id = 'e341023a-9e75-407e-ae76-1817dbd4eaae' and house_slug is null;

insert into public.projects (name, description, platform, house_slug, house_group, current_version)
select 'Tradin One', 'Android app com.catalyst.tradin', 'android', 'tradin', 'tradin', '1.0.5'
 where not exists (select 1 from public.projects where house_slug = 'tradin');
