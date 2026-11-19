import { LogOut } from "lucide-react";
import { signOutAction } from "@/server/actions/auth";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ButtonProps } from "@/components/ui/button";

export function SignOutButton({ className, variant = "ghost", size = "default" }: Pick<ButtonProps, "className" | "variant" | "size">) {
  return (
    <form action={signOutAction}>
      <SubmitButton variant={variant} size={size} className={className} pendingLabel="Déconnexion…">
        <LogOut /> Se déconnecter
      </SubmitButton>
    </form>
  );
}
