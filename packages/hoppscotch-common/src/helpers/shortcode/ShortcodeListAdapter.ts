import * as E from "fp-ts/Either"
import { BehaviorSubject, Subscription } from "rxjs"
import { Subscription as WSubscription } from "wonka"
import {
  GQLError,
  runAuthOnlyGQLSubscription,
  runGQLQuery,
} from "../backend/GQLClient"
import {
  GetUserShortcodesQuery,
  GetUserShortcodesDocument,
  ShortcodeCreatedDocument,
  ShortcodeDeletedDocument,
} from "../backend/graphql"
import { BACKEND_PAGE_SIZE } from "../backend/helpers"
import { Shortcode } from "./Shortcode"

export default class SharedRequestListAdapter {
  error$: BehaviorSubject<GQLError<string> | null>
  loading$: BehaviorSubject<boolean>
  shortcodes$: BehaviorSubject<GetUserShortcodesQuery["myShortcodes"]>
  hasMoreShortcode$: BehaviorSubject<boolean>

  private isDispose: boolean

  private shortcodeCreated: Subscription | null
  private shortcodeRevoked: Subscription | null

  private shortcodeCreatedSub: WSubscription | null
  private shortcodeRevokedSub: WSubscription | null

  constructor(deferInit = false) {
    this.error$ = new BehaviorSubject<GQLError<string> | null>(null)
    this.loading$ = new BehaviorSubject<boolean>(false)
    this.shortcodes$ = new BehaviorSubject<
      GetUserShortcodesQuery["myShortcodes"]
    >([])
    this.hasMoreShortcode$ = new BehaviorSubject<boolean>(true)
    this.isDispose = true
    this.shortcodeCreated = null
    this.shortcodeRevoked = null
    this.shortcodeCreatedSub = null
    this.shortcodeRevokedSub = null

    if (!deferInit) this.initialize()
  }

  unsubscribeSubscriptions() {
    this.shortcodeCreated?.unsubscribe()
    this.shortcodeRevoked?.unsubscribe()
    this.shortcodeCreatedSub?.unsubscribe()
    this.shortcodeRevokedSub?.unsubscribe()
  }

  initialize() {
    if (!this.isDispose) throw new Error(`Adapter is already initialized`)

    this.fetchList()
    this.registerSubscriptions()
  }

  /**
   * Returns whether the shortcode adapter is active and initialized
   */
  public isInitialized() {
    return !this.isDispose
  }

  public dispose() {
    if (this.isDispose) throw new Error(`Adapter has been disposed`)

    this.isDispose = true
    this.unsubscribeSubscriptions()
  }

  fetchList() {
    this.loadMore(true)
  }

  async loadMore(forcedAttempt = false) {
    if (!this.hasMoreShortcode$.value && !forcedAttempt) return

    this.loading$.next(true)

    const lastCodeID =
      this.shortcodes$.value.length > 0
        ? this.shortcodes$.value[this.shortcodes$.value.length - 1].id
        : undefined

    const result = await runGQLQuery({
      query: GetUserShortcodesDocument,
      variables: {
        cursor: lastCodeID,
      },
    })
    if (E.isLeft(result)) {
      this.error$.next(result.left)
      console.error(result.left)
      this.loading$.next(false)

      throw new Error(`Failed fetching shortcode list: ${result.left}`)
    }

    const fetchedResult = result.right.myShortcodes

    this.pushNewShortcode(fetchedResult)

    if (fetchedResult.length !== BACKEND_PAGE_SIZE) {
      this.hasMoreShortcode$.next(false)
    }

    this.loading$.next(false)
  }

  private pushNewShortcode(results: Shortcode[]) {
    const userShortcodes = this.shortcodes$.value

    userShortcodes.push(...results)

    this.shortcodes$.next(userShortcodes)
  }

  private createShortcode(shortcodes: Shortcode) {
    const userShortcode = this.shortcodes$.value

    userShortcode.unshift(shortcodes)

    this.shortcodes$.next(userShortcode)
  }

  private deleteSharedRequest(codeId: string) {
    const newShortcode = this.shortcodes$.value.filter(
      ({ id }) => id !== codeId
    )

    this.shortcodes$.next(newShortcode)
  }

  private registerSubscriptions() {
    const [shortcodeCreated$, shortcodeCreatedSub] = runAuthOnlyGQLSubscription(
      {
        query: ShortcodeCreatedDocument,
      }
    )

    this.shortcodeCreatedSub = shortcodeCreatedSub
    this.shortcodeCreated = shortcodeCreated$.subscribe((result) => {
      if (E.isLeft(result)) {
        console.error(result.left)
        throw new Error(`Shortcode Create Error ${result.left}`)
      }

      this.createShortcode(result.right.myShortcodesCreated)
    })

    const [shortcodeRevoked$, shortcodeRevokedSub] = runAuthOnlyGQLSubscription(
      {
        query: ShortcodeDeletedDocument,
      }
    )

    this.shortcodeRevokedSub = shortcodeRevokedSub
    this.shortcodeRevoked = shortcodeRevoked$.subscribe((result) => {
      if (E.isLeft(result)) {
        console.error(result.left)
        throw new Error(`Shortcode Delete Error ${result.left}`)
      }

      this.deleteSharedRequest(result.right.myShortcodesRevoked.id)
    })
  }
}
