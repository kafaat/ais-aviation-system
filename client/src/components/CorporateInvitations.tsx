import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
export function CorporateInvitations() {
  const l = useOperationalLabels();
  const query = trpc.corporate.myInvitations.useQuery();
  const utils = trpc.useUtils();
  const accept = trpc.corporate.acceptInvitation.useMutation({
    onSuccess: () => {
      void utils.corporate.invalidate();
      toast.success(l("تم قبول الدعوة", "Invitation accepted"));
    },
    onError: e => toast.error(e.message),
  });
  return (
    <OperationalReadState query={query}>
      {query.data?.map(invitation => (
        <section className="border rounded p-4 mb-4" key={invitation.id}>
          <h2>
            {l("دعوة شركة", "Company invitation")}: {invitation.companyName}
          </h2>
          <p>
            {invitation.role} · {l("تنتهي", "Expires")}:{" "}
            {invitation.expiresAt.toLocaleString()}
          </p>
          <Button
            disabled={accept.isPending}
            onClick={() => accept.mutate({ invitationId: invitation.id })}
          >
            {l("قبول الدعوة", "Accept invitation")}
          </Button>
        </section>
      ))}
    </OperationalReadState>
  );
}
