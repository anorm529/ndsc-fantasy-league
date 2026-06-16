import { requireSession } from "@/app/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <>{children}</>;
}
