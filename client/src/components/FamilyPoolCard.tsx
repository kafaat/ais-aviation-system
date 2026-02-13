import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Users, Plus, Trash2, Plane, Crown, User, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function FamilyPoolCard() {
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [contributeMiles, setContributeMiles] = useState("");

  const utils = trpc.useUtils();

  const { data: group, isLoading } = trpc.familyPool.myGroup.useQuery(
    undefined,
    { retry: false }
  );

  const createGroup = trpc.familyPool.createGroup.useMutation({
    onSuccess: () => {
      toast.success(t("familyPool.createSuccess"));
      utils.familyPool.myGroup.invalidate();
      setGroupName("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const addMember = trpc.familyPool.addMember.useMutation({
    onSuccess: () => {
      toast.success(t("familyPool.addSuccess"));
      utils.familyPool.myGroup.invalidate();
      setMemberEmail("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const removeMember = trpc.familyPool.removeMember.useMutation({
    onSuccess: () => {
      utils.familyPool.myGroup.invalidate();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const contribute = trpc.familyPool.contributeMiles.useMutation({
    onSuccess: () => {
      toast.success(t("familyPool.contributeSuccess"));
      utils.familyPool.myGroup.invalidate();
      setContributeMiles("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const deleteGroup = trpc.familyPool.deleteGroup.useMutation({
    onSuccess: () => {
      toast.success(t("familyPool.deleteSuccess"));
      utils.familyPool.myGroup.invalidate();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-20 bg-muted rounded" />
        </div>
      </Card>
    );
  }

  // No group - show creation form
  if (!group) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-5 w-5" />
          <h3 className="font-semibold">{t("familyPool.title")}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {t("familyPool.noGroup")}
        </p>

        <div className="space-y-3">
          <div>
            <Label>{t("familyPool.groupName")}</Label>
            <Input
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder={t("familyPool.groupName")}
              className="mt-1"
            />
          </div>
          <Button
            onClick={() => createGroup.mutate({ name: groupName })}
            disabled={!groupName.trim() || createGroup.isPending}
            className="w-full"
          >
            {createGroup.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {t("familyPool.createGroup")}
          </Button>
        </div>
      </Card>
    );
  }

  // Show existing group
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <h3 className="font-semibold">{group.name}</h3>
        </div>
        <Badge variant="outline" className="text-lg px-3 py-1">
          <Plane className="h-4 w-4 mr-1" />
          {group.pooledMiles?.toLocaleString() || 0} {t("familyPool.miles")}
        </Badge>
      </div>

      <Separator className="my-4" />

      {/* Members List */}
      <div className="space-y-2 mb-4">
        <h4 className="text-sm font-medium text-muted-foreground">
          {t("familyPool.members")} ({group.members?.length || 0}/
          {group.maxMembers})
        </h4>
        {group.members?.map(
          (member: {
            id: number;
            userId: number;
            role: "owner" | "member";
            userName: string | null;
            userEmail: string | null;
            currentMiles: number | null;
            tier: string | null;
            milesContributed: number;
            milesRedeemed: number;
            joinedAt: Date;
          }) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {member.role === "owner" ? (
                  <Crown className="h-4 w-4 text-amber-500" />
                ) : (
                  <User className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {member.userName || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {member.currentMiles?.toLocaleString() || 0}{" "}
                    {t("familyPool.miles")}
                    {member.tier && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {member.tier}
                      </Badge>
                    )}
                  </p>
                </div>
              </div>
              {group.myRole === "owner" && member.role !== "owner" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    removeMember.mutate({
                      groupId: group.id,
                      memberId: member.userId,
                    })
                  }
                  disabled={removeMember.isPending}
                >
                  <Trash2 className="h-3 w-3 text-red-500" />
                </Button>
              )}
            </div>
          )
        )}
      </div>

      {/* Add Member (owner only) */}
      {group.myRole === "owner" && (
        <>
          <div className="flex gap-2 mb-4">
            <Input
              value={memberEmail}
              onChange={e => setMemberEmail(e.target.value)}
              placeholder={t("familyPool.memberEmail")}
              type="email"
              className="flex-1"
            />
            <Button
              onClick={() =>
                addMember.mutate({
                  groupId: group.id,
                  memberEmail,
                })
              }
              disabled={!memberEmail.trim() || addMember.isPending}
              size="sm"
            >
              {addMember.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
        </>
      )}

      {/* Contribute Miles */}
      <Separator className="my-4" />
      <div className="flex gap-2">
        <Input
          value={contributeMiles}
          onChange={e => setContributeMiles(e.target.value)}
          placeholder={t("familyPool.contribute")}
          type="number"
          min={100}
          className="flex-1"
        />
        <Button
          onClick={() =>
            contribute.mutate({
              groupId: group.id,
              miles: parseInt(contributeMiles),
            })
          }
          disabled={
            !contributeMiles ||
            parseInt(contributeMiles) < 100 ||
            contribute.isPending
          }
          variant="secondary"
        >
          {contribute.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            t("familyPool.contribute")
          )}
        </Button>
      </div>

      {/* Delete Group (owner only) */}
      {group.myRole === "owner" && (
        <>
          <Separator className="my-4" />
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => deleteGroup.mutate({ groupId: group.id })}
            disabled={deleteGroup.isPending}
          >
            {deleteGroup.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {t("familyPool.deleteGroup")}
          </Button>
        </>
      )}
    </Card>
  );
}
