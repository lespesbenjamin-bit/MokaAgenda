import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function FormAlert({ type, children }: { type: "error" | "success" | "info"; children: React.ReactNode }) {
  const Icon = type === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm",
        type === "error" && "bg-destructive/8 text-destructive",
        type === "success" && "bg-success-soft text-success",
        type === "info" && "bg-secondary text-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
