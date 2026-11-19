import { getSupabasePublicConfig } from "@/lib/env";
import { FormAlert } from "@/components/ui/form-alert";

/** Signale clairement une configuration Supabase absente, au lieu d'une erreur obscure. */
export function ConfigWarning() {
  if (getSupabasePublicConfig()) return null;
  return (
    <div className="mb-5">
      <FormAlert type="error">
        La connexion n&apos;est pas encore configurée sur ce déploiement (variables Supabase manquantes).
      </FormAlert>
    </div>
  );
}
