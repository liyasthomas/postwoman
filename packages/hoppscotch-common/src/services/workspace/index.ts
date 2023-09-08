import { tryOnScopeDispose, useIntervalFn } from "@vueuse/core"
import { Service } from "dioc"
import { computed, reactive, ref, watch } from "vue"
import { useStreamStatic } from "~/composables/stream"
import TeamListAdapter from "~/helpers/teams/TeamListAdapter"
import { platform } from "~/platform"
import { min } from "lodash-es"

type Workspace =
  | { type: "personal" }
  | { type: "team"; teamID: string; teamName: string }

type WorkspaceServiceEvent = {
  type: "managed-team-list-adapter-polled"
}

export class WorkspaceService extends Service<WorkspaceServiceEvent> {
  public static readonly ID = "WORKSPACE_SERVICE"

  // TODO: Control and validate writes into this (refWithControl ?)
  public currentWorkspace = ref<Workspace>({ type: "personal" })

  private teamListAdapterLocks = reactive(new Map<number, number | null>())
  private teamListAdapterLockTicker = 0
  private managedTeamListAdapter = new TeamListAdapter(true, false)

  private currentUser = useStreamStatic(
    platform.auth.getCurrentUserStream(),
    platform.auth.getCurrentUser(),
    () => {
      /* noop */
    }
  )[0]

  private readonly pollingTime = computed(
    () =>
      min(Array.from(this.teamListAdapterLocks.values()).filter((x) => !!x)) ??
      -1
  )

  constructor() {
    super()

    watch(
      this.currentUser,
      (user) => {
        if (!user && this.managedTeamListAdapter.isInitialized) {
          this.managedTeamListAdapter.dispose()
        }

        if (user && !this.managedTeamListAdapter.isInitialized) {
          this.managedTeamListAdapter.initialize()
        }
      },
      { immediate: true }
    )

    const { pause: pauseListPoll, resume: resumeListPoll } = useIntervalFn(
      () => {
        if (this.managedTeamListAdapter.isInitialized) {
          this.managedTeamListAdapter.fetchList()

          this.emit({ type: "managed-team-list-adapter-polled" })
        }
      },
      this.pollingTime,
      { immediate: true }
    )

    watch(
      this.pollingTime,
      (pollingTime) => {
        if (pollingTime === -1) {
          pauseListPoll()
        } else {
          resumeListPoll()
        }
      },
      { immediate: true }
    )
  }

  public acquireTeamListAdapter(pollDuration: number | null) {
    const lockID = this.teamListAdapterLockTicker++

    this.teamListAdapterLocks.set(lockID, pollDuration)

    tryOnScopeDispose(() => {
      this.teamListAdapterLocks.delete(lockID)
    })

    return this.managedTeamListAdapter
  }
}
