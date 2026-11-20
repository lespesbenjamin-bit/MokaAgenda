import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerIdentityForm } from "@/components/customers/customer-forms";

export const metadata: Metadata = { title: "Nouvelle cliente" };

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader title="Nouvelle cliente" description="Seul un prénom ou un nom est obligatoire. Vous pourrez compléter la fiche plus tard." />
      <div className="max-w-3xl rounded-2xl border border-border bg-card p-5 sm:p-6">
        <CustomerIdentityForm defaults={{ first_name: "", last_name: "", email: "", phone: "", birth_date: "", notes: "" }} />
      </div>
    </>
  );
}
