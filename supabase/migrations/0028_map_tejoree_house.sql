-- Tejoree is a 9th automated house: Android app com.catalyst.nxgac (on-device name 'Tejoree', v1.0.2,
-- confirmed with aapt from the installed APK). Its catalyst project gets the house mapping so automation
-- jobs sent from it can be claimed by a runner and filed under this house.
update public.projects
   set house_slug = 'nxgac', house_group = 'nxgac', current_version = '1.0.2'
 where id = '1068a491-cfe4-463c-9ca9-614203fa9518' and house_slug is null;
