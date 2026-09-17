import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import HubClient from "./HubClient";

export default async function HubPage(){
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <HubClient />;
}
