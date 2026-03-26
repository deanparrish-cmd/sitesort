import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Building2 } from "lucide-react";
import { useLogin } from "@workspace/api-client-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const loginMutation = useLogin();

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema)
  });

  const onSubmit = async (data: LoginForm) => {
    setError(null);
    try {
      const response = await loginMutation.mutateAsync({ data });
      localStorage.setItem("sitesort_token", response.token);
      setLocation("/dashboard");
    } catch (err: any) {
      setError(err.message || "Invalid credentials. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 relative">
      <div className="absolute inset-0 z-0 opacity-20">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
          alt="Background" 
          className="w-full h-full object-cover"
        />
      </div>
      
      <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 relative z-10 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-primary">Welcome back</h1>
          <p className="text-muted-foreground mt-2">Log in to your SiteSort account</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <Input 
              {...register("email")} 
              type="email" 
              placeholder="Email address" 
              icon={<Mail className="w-5 h-5" />}
            />
            {errors.email && <p className="text-destructive text-sm mt-1 ml-1">{errors.email.message}</p>}
          </div>
          
          <div>
            <Input 
              {...register("password")} 
              type="password" 
              placeholder="Password" 
              icon={<Lock className="w-5 h-5" />}
            />
            {errors.password && <p className="text-destructive text-sm mt-1 ml-1">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full" size="lg" isLoading={loginMutation.isPending}>
            Log In
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Register your company
          </Link>
        </div>
      </div>
    </div>
  );
}
