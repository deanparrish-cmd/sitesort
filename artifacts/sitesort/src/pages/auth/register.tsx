import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Building2, User } from "lucide-react";
import { useRegister, RegisterRequestCompanySize } from "@workspace/api-client-react";

const registerSchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  adminName: z.string().min(2, "Your name is required"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  companySize: z.nativeEnum(RegisterRequestCompanySize),
});

type RegisterForm = z.infer<typeof registerSchema>;

export default function Register() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const registerMutation = useRegister();

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      companySize: "1-10"
    }
  });

  const onSubmit = async (data: RegisterForm) => {
    setError(null);
    try {
      const response = await registerMutation.mutateAsync({ data });
      localStorage.setItem("sitesort_token", response.token);
      setLocation("/dashboard");
    } catch (err: any) {
      setError(err.message || "Registration failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 relative py-12">
      <div className="absolute inset-0 z-0 opacity-20">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
          alt="Background" 
          className="w-full h-full object-cover"
        />
      </div>
      
      <div className="w-full max-w-lg p-8 bg-card rounded-2xl shadow-2xl border border-border/50 relative z-10 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-accent/20">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-3xl font-display font-bold text-primary">Create Account</h1>
          <p className="text-muted-foreground mt-2">Get started with SiteSort</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-5">
            <div>
              <Input 
                {...register("companyName")} 
                placeholder="Company Name" 
                icon={<Building2 className="w-5 h-5" />}
              />
              {errors.companyName && <p className="text-destructive text-sm mt-1 ml-1">{errors.companyName.message}</p>}
            </div>
            
            <div>
              <select 
                {...register("companySize")}
                className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10"
              >
                <option value="1-10">1-10 Employees</option>
                <option value="11-50">11-50 Employees</option>
                <option value="51-200">51-200 Employees</option>
                <option value="201+">201+ Employees</option>
              </select>
              {errors.companySize && <p className="text-destructive text-sm mt-1 ml-1">{errors.companySize.message}</p>}
            </div>

            <div className="h-px bg-border my-4"></div>

            <div>
              <Input 
                {...register("adminName")} 
                placeholder="Your Full Name" 
                icon={<User className="w-5 h-5" />}
              />
              {errors.adminName && <p className="text-destructive text-sm mt-1 ml-1">{errors.adminName.message}</p>}
            </div>

            <div>
              <Input 
                {...register("email")} 
                type="email" 
                placeholder="Work Email" 
                icon={<Mail className="w-5 h-5" />}
              />
              {errors.email && <p className="text-destructive text-sm mt-1 ml-1">{errors.email.message}</p>}
            </div>
            
            <div>
              <Input 
                {...register("password")} 
                type="password" 
                placeholder="Create Password" 
                icon={<Lock className="w-5 h-5" />}
              />
              {errors.password && <p className="text-destructive text-sm mt-1 ml-1">{errors.password.message}</p>}
            </div>
          </div>

          <Button type="submit" variant="accent" className="w-full mt-8" size="lg" isLoading={registerMutation.isPending}>
            Create Account
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
