-- Four more automated houses, installed on the test phone and confirmed with aapt (on-device label -> project):
--   com.catalyst.abaali       'Aba Ali Habib Tick NxG'  v1.0.3 -> ABA ALI HABIB SECURITIES (AAH)
--   com.catalyst.nxgahcml     'AL Habib Capital GROW'   v1.0.8 -> Al Habib Capital Market ... (AHCML)
--   com.catalyst.nxgahletrade 'AHL NxG Pro'             v1.0.7 -> AHL
--   com.catalyst.nxgyh        'YH Investments'          v1.0.6 -> Yaqoob Habib
-- current_version is seeded from each app's installed versionName (as for the first 8 houses).
update public.projects p
   set house_slug = m.slug, house_group = m.slug, current_version = m.ver
  from (values
    ('168a1e00-2723-457c-923d-c2b9ce88c19c'::uuid, 'abaali',       '1.0.3'),
    ('d3524540-69ba-4414-9261-f423382d0362'::uuid, 'nxgahcml',     '1.0.8'),
    ('579a0d29-4b84-401d-919b-944b8944eb7d'::uuid, 'nxgahletrade', '1.0.7'),
    ('002af164-4550-4d9c-ab0d-fc3fb6868be7'::uuid, 'nxgyh',        '1.0.6')
  ) as m(id, slug, ver)
 where p.id = m.id and p.house_slug is null;
