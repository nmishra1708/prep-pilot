import { z } from "zod";

const commonPasswords = new Set([
  "password123", "password1234", "qwerty12345", "letmein1234", "admin123456",
  "welcome1234", "iloveyou123", "1234567890", "changeme123", "p@ssword123",
]);

export const emailSchema = z.string().trim().email("Enter a valid email address.").max(254).transform((email) => email.toLowerCase());
export const passwordSchema = z.string()
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password must be no more than 128 characters.")
  .refine((password) => !commonPasswords.has(password.toLowerCase()), "Choose a less common password.");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string().min(1, "Confirm your password."),
  acceptTerms: z.literal(true, "You must accept the terms to create an account."),
}).strict().refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().default(false),
}).strict();

export const emailOnlySchema = z.object({ email: emailSchema }).strict();
export const tokenSchema = z.object({ token: z.string().min(32).max(256) }).strict();
export const resetPasswordSchema = tokenSchema.extend({ password: passwordSchema, confirmPassword: z.string().min(1) })
  .strict()
  .refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const profileSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
  confirmPassword: z.string().min(1),
}).strict().refine((value) => value.newPassword === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) }).strict();
