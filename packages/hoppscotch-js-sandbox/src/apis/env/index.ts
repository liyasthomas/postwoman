import { Environment, parseTemplateStringE } from "@hoppscotch/data"
import cloneDeep from "lodash/cloneDeep"
import { pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import * as E from "fp-ts/Either"
import {
  defineAPI,
  onPreRequestScriptComplete,
  onTestScriptComplete,
} from "../../api"
import {
  setFnHandlers,
  disposeHandlers,
  mergeEnvs,
  defineHandleFn,
  HandleFnPairs,
} from "../../utils"
import { deleteEnv, getEnv, setEnv } from "./utils"
import { api, Namespaced } from "../../apiManager"
import EnvGlobalAPI from "./global"
import EnvActiveAPI from "./active"

export type EnvKeys =
  | "set"
  | "get"
  | "resolve"
  | "getResolve"
  | "delete"
  | "getRaw"

export type Envs = {
  global: Environment["variables"]
  selected: Environment["variables"]
}

export default (initialEnvs: Envs) =>
  defineAPI("env", (vm) => {
    const handle = vm.newObject()

    const data = { envs: cloneDeep(initialEnvs) }

    const getHandleFn = defineHandleFn((keyHandle) => {
      const { envs: currentEnvs } = data
      const key: unknown = vm.dump(keyHandle)

      if (typeof key !== "string") {
        return {
          error: vm.newString("Expected key to be a string"),
        }
      }

      const result = pipe(
        getEnv(key, currentEnvs),
        E.fromOption(() => "INVALID_KEY" as const),

        E.map(({ value }) =>
          pipe(
            parseTemplateStringE(value, [
              ...initialEnvs.selected,
              ...initialEnvs.global,
            ]),
            // If the recursive resolution failed, return the unresolved value
            E.getOrElse(() => value)
          )
        ),

        // Create a new VM String
        // NOTE: Do not shorten this to map(vm.newString) apparently it breaks it
        E.map((x) => vm.newString(x)),

        E.getOrElse(() => vm.undefined)
      )

      return {
        value: result,
      }
    })

    const getResolveHandleFn = getHandleFn

    const setHandleFn = defineHandleFn((keyHandle, valueHandle) => {
      const { envs: currentEnvs } = data
      const key: unknown = vm.dump(keyHandle)
      const value: unknown = vm.dump(valueHandle)

      if (typeof key !== "string") {
        return {
          error: vm.newString("Expected key to be a string"),
        }
      }

      if (typeof value !== "string") {
        return {
          error: vm.newString("Expected value to be a string"),
        }
      }

      data.envs = setEnv(key, value, currentEnvs)

      return {
        value: vm.undefined,
      }
    })

    const resolveHandleFn = defineHandleFn((valueHandle) => {
      const { envs: currentEnvs } = data
      const value: unknown = vm.dump(valueHandle)

      if (typeof value !== "string") {
        return {
          error: vm.newString("Expected value to be a string"),
        }
      }

      const result = pipe(
        parseTemplateStringE(value, [
          ...currentEnvs.selected,
          ...currentEnvs.global,
        ]),
        E.getOrElse(() => value)
      )

      return {
        value: vm.newString(result),
      }
    })

    const deleteHandleFn = defineHandleFn((keyHandle) => {
      const { envs: currentEnvs } = data
      const key: unknown = vm.dump(keyHandle)

      if (typeof key !== "string") {
        return {
          error: vm.newString("Expected key to be a string"),
        }
      }

      data.envs = deleteEnv(key, currentEnvs)

      return {
        value: vm.undefined,
      }
    })

    const getRawHandleFn = defineHandleFn((keyHandle) => {
      const { envs: currentEnvs } = data
      const key: unknown = vm.dump(keyHandle)

      if (typeof key !== "string") {
        return {
          error: vm.newString("Expected key to be a string"),
        }
      }

      const result = pipe(
        getEnv(key, currentEnvs),
        O.match(
          () => vm.undefined,
          ({ value }) => vm.newString(value)
        )
      )

      return {
        value: result,
      }
    })

    const handleFnPairs: HandleFnPairs<EnvKeys>[] = [
      { key: "get", func: getHandleFn },
      { key: "getResolve", func: getResolveHandleFn },
      { key: "set", func: setHandleFn },
      { key: "resolve", func: resolveHandleFn },
      { key: "delete", func: deleteHandleFn },
      { key: "getRaw", func: getRawHandleFn },
    ]

    const handlers = setFnHandlers(vm, handle, handleFnPairs)
    disposeHandlers(handlers)

    const childAPIs = [
      api([EnvGlobalAPI(data), Namespaced("global")]),
      api([EnvActiveAPI(data), Namespaced("active")]),
    ]

    const exposed = {
      getEnvs: () => cloneDeep(data.envs),
    }

    onPreRequestScriptComplete((report) => ({
      ...report,
      envs: {
        global: mergeEnvs(report.envs.global, data.envs.global),
        selected: mergeEnvs(report.envs.selected, data.envs.selected),
      },
    }))

    onTestScriptComplete((report) => ({
      ...report,
      envs: {
        global: mergeEnvs(report.envs.global, data.envs.global),
        selected: mergeEnvs(report.envs.selected, data.envs.selected),
      },
    }))

    return {
      rootHandle: handle,
      exposes: exposed,
      childAPIs: childAPIs,
    }
  })
