import { env } from "@repo/env/api";
import { Resend } from "resend";

export const resend = new Resend(env.RESEND_TOKEN);
