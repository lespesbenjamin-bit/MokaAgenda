-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 1 — Stockage des logos
-- Bucket public en lecture (logo affiché plus tard sur la page de
-- réservation), écriture réservée au propriétaire de l'entreprise.
-- Chemin imposé : {business_id}/{nom-de-fichier}
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy business_logos_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and (select private.has_business_role(
      private.try_uuid((storage.foldername(name))[1]),
      array['business_owner']::public.member_role[]))
  );

create policy business_logos_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-logos'
    and (select private.has_business_role(
      private.try_uuid((storage.foldername(name))[1]),
      array['business_owner']::public.member_role[]))
  )
  with check (
    bucket_id = 'business-logos'
    and (select private.has_business_role(
      private.try_uuid((storage.foldername(name))[1]),
      array['business_owner']::public.member_role[]))
  );

create policy business_logos_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-logos'
    and (select private.has_business_role(
      private.try_uuid((storage.foldername(name))[1]),
      array['business_owner']::public.member_role[]))
  );

-- Lecture via l'API (liste/téléchargement) limitée aux membres ;
-- l'URL publique du bucket reste accessible pour l'affichage du logo.
create policy business_logos_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-logos'
    and (select private.is_business_member(private.try_uuid((storage.foldername(name))[1])))
  );
