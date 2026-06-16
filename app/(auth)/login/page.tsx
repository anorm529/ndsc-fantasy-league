import Image from "next/image";
import { LoginForm } from "./login-form";
import { getSession } from "@/app/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Login — NDSC Fantasy Softball",
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-ndsc-navy via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <Image
              src="/fantasy-logo.png"
              alt="NDSC Fantasy League"
              width={120}
              height={120}
              priority
            />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            NDSC Fantasy
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Softball League Manager
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-1">
            Sign in to your account
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Use your NDSC member credentials
          </p>
          <LoginForm />
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          NDSC Fantasy Softball League &copy; 2026
        </p>
      </div>
    </div>
  );
}
