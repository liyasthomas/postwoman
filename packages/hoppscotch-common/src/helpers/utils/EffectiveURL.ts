import {
  Environment,
  FormDataKeyValue,
  HoppRESTAuth,
  HoppRESTHeader,
  HoppRESTHeaders,
  HoppRESTParam,
  HoppRESTParams,
  HoppRESTReqBody,
  HoppRESTRequest,
  parseBodyEnvVariables,
  parseRawKeyValueEntriesE,
  parseTemplateString,
  parseTemplateStringE,
} from "@hoppscotch/data"
import { AwsV4Signer } from "aws4fetch"
import * as A from "fp-ts/Array"
import * as E from "fp-ts/Either"
import { flow, pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import * as RA from "fp-ts/ReadonlyArray"
import * as S from "fp-ts/string"
import qs from "qs"
import { combineLatest, Observable } from "rxjs"
import { map } from "rxjs/operators"

import { arrayFlatMap, arraySort } from "../functional/array"
import { toFormData } from "../functional/formData"
import { tupleWithSameKeysToRecord } from "../functional/record"
import { isJSONContentType } from "./contenttypes"
import { stripComments } from "../editor/linting/jsonc"

import {
  DigestAuthParams,
  fetchInitialDigestAuthInfo,
  generateDigestAuthHeader,
} from "../auth/digest"
import { calculateHawkHeader } from "@hoppscotch/data"
import { calculateAkamaiEdgeGridHeader } from "@hoppscotch/data"

export interface EffectiveHoppRESTRequest extends HoppRESTRequest {
  /**
   * The effective final URL.
   *
   * This contains path, params and environment variables all applied to it
   */
  effectiveFinalURL: string
  effectiveFinalHeaders: HoppRESTHeaders
  effectiveFinalParams: HoppRESTParams
  effectiveFinalBody: FormData | string | null | File | Blob
  effectiveFinalRequestVariables: { key: string; value: string }[]
}

/**
 * Get headers that can be generated by authorization config of the request
 * @param req Request to check
 * @param envVars Currently active environment variables
 * @param auth Authorization config to check
 * @param parse Whether to parse the template strings
 * @param showKeyIfSecret Whether to show the key if the value is a secret
 * @returns The list of headers
 */
export const getComputedAuthHeaders = async (
  envVars: Environment["variables"],
  req?:
    | HoppRESTRequest
    | {
        auth: HoppRESTAuth
        headers: HoppRESTHeaders
      },
  auth?: HoppRESTRequest["auth"],
  parse = true,
  showKeyIfSecret = false
) => {
  const request = auth ? { auth: auth ?? { authActive: false } } : req
  // If Authorization header is also being user-defined, that takes priority
  if (req && req.headers.find((h) => h.key.toLowerCase() === "authorization"))
    return []

  if (!request) return []

  if (!request.auth || !request.auth.authActive) return []

  const headers: HoppRESTHeader[] = []

  // TODO: Support a better b64 implementation than btoa ?
  if (request.auth.authType === "basic") {
    const username = parse
      ? parseTemplateString(
          request.auth.username,
          envVars,
          false,
          showKeyIfSecret
        )
      : request.auth.username
    const password = parse
      ? parseTemplateString(
          request.auth.password,
          envVars,
          false,
          showKeyIfSecret
        )
      : request.auth.password

    headers.push({
      active: true,
      key: "Authorization",
      value: `Basic ${btoa(`${username}:${password}`)}`,
      description: "",
    })
  } else if (request.auth.authType === "digest") {
    const { method, endpoint } = request as HoppRESTRequest

    // Step 1: Fetch the initial auth info (nonce, realm, etc.)
    const authInfo = await fetchInitialDigestAuthInfo(
      parseTemplateString(endpoint, envVars),
      method
    )

    const reqBody = getFinalBodyFromRequest(
      req as HoppRESTRequest,
      envVars,
      showKeyIfSecret
    )

    // Step 2: Set up the parameters for the digest authentication header
    const digestAuthParams: DigestAuthParams = {
      username: parseTemplateString(request.auth.username, envVars),
      password: parseTemplateString(request.auth.password, envVars),
      realm: request.auth.realm
        ? parseTemplateString(request.auth.realm, envVars)
        : authInfo.realm,
      nonce: request.auth.nonce
        ? parseTemplateString(authInfo.nonce, envVars)
        : authInfo.nonce,
      endpoint: parseTemplateString(endpoint, envVars),
      method,
      algorithm: request.auth.algorithm ?? authInfo.algorithm,
      qop: request.auth.qop
        ? parseTemplateString(request.auth.qop, envVars)
        : authInfo.qop,
      opaque: request.auth.opaque
        ? parseTemplateString(request.auth.opaque, envVars)
        : authInfo.opaque,
      reqBody: typeof reqBody === "string" ? reqBody : "",
    }

    // Step 3: Generate the Authorization header
    const authHeaderValue = await generateDigestAuthHeader(digestAuthParams)

    headers.push({
      active: true,
      key: "Authorization",
      value: authHeaderValue,
      description: "",
    })
  } else if (
    request.auth.authType === "bearer" ||
    (request.auth.authType === "oauth-2" && request.auth.addTo === "HEADERS")
  ) {
    const token =
      request.auth.authType === "bearer"
        ? request.auth.token
        : request.auth.grantTypeInfo.token

    headers.push({
      active: true,
      key: "Authorization",
      value: `Bearer ${
        parse
          ? parseTemplateString(token, envVars, false, showKeyIfSecret)
          : token
      }`,
      description: "",
    })
  } else if (request.auth.authType === "api-key") {
    const { key, addTo } = request.auth
    if (addTo === "HEADERS" && key) {
      headers.push({
        active: true,
        key: parseTemplateString(key, envVars, false, showKeyIfSecret),
        value: parse
          ? parseTemplateString(
              request.auth.value ?? "",
              envVars,
              false,
              showKeyIfSecret
            )
          : (request.auth.value ?? ""),
        description: "",
      })
    }
  } else if (request.auth.authType === "aws-signature") {
    const { addTo } = request.auth
    if (addTo === "HEADERS") {
      const currentDate = new Date()
      const amzDate = currentDate.toISOString().replace(/[:-]|\.\d{3}/g, "")
      const { method, endpoint } = req as HoppRESTRequest
      const signer = new AwsV4Signer({
        method: method,
        datetime: amzDate,
        accessKeyId: parseTemplateString(request.auth.accessKey, envVars),
        secretAccessKey: parseTemplateString(request.auth.secretKey, envVars),
        region:
          parseTemplateString(request.auth.region, envVars) ?? "us-east-1",
        service: parseTemplateString(request.auth.serviceName, envVars),
        sessionToken:
          request.auth.serviceToken &&
          parseTemplateString(request.auth.serviceToken, envVars),
        url: parseTemplateString(endpoint, envVars),
      })

      const sign = await signer.sign()

      sign.headers.forEach((x, k) => {
        headers.push({
          active: true,
          key: k,
          value: x,
          description: "",
        })
      })
    }
  } else if (request.auth.authType === "hawk") {
    const { method, endpoint } = req as HoppRESTRequest

    const hawkHeader = await calculateHawkHeader({
      url: parseTemplateString(endpoint, envVars), // URL
      method: method, // HTTP method
      id: parseTemplateString(request.auth.authId, envVars),
      key: parseTemplateString(request.auth.authKey, envVars),
      algorithm: request.auth.algorithm,

      // advanced parameters (optional)
      includePayloadHash: request.auth.includePayloadHash,
      nonce: request.auth.nonce
        ? parseTemplateString(request.auth.nonce, envVars)
        : undefined,
      ext: request.auth.ext
        ? parseTemplateString(request.auth.ext, envVars)
        : undefined,
      app: request.auth.app
        ? parseTemplateString(request.auth.app, envVars)
        : undefined,
      dlg: request.auth.dlg
        ? parseTemplateString(request.auth.dlg, envVars)
        : undefined,
      timestamp: request.auth.timestamp
        ? parseInt(parseTemplateString(request.auth.timestamp, envVars), 10)
        : undefined,
    })

    console.log(hawkHeader)

    headers.push({
      active: true,
      key: "Authorization",
      value: hawkHeader,
      description: "",
    })
  } else if (request.auth.authType === "akamai-eg") {
    const { method, endpoint } = req as HoppRESTRequest

    // Get the request body
    const reqBody = getFinalBodyFromRequest(
      req as HoppRESTRequest,
      envVars,
      showKeyIfSecret
    )

    const authHeader = await calculateAkamaiEdgeGridHeader({
      accessToken: parseTemplateString(request.auth.accessToken, envVars),
      clientToken: parseTemplateString(request.auth.clientToken, envVars),
      clientSecret: parseTemplateString(request.auth.clientSecret, envVars),
      url: parseTemplateString(endpoint, envVars),
      method: method,
      // Pass the request body to the function
      body: typeof reqBody === "string" ? reqBody : undefined,
      nonce: request.auth.nonce
        ? parseTemplateString(request.auth.nonce, envVars)
        : undefined,
      timestamp: request.auth.timestamp
        ? parseTemplateString(request.auth.timestamp, envVars)
        : undefined,
      host: request.auth.host
        ? parseTemplateString(request.auth.host, envVars)
        : undefined,
      headersToSign: request.auth.headersToSign
        ? parseTemplateString(request.auth.headersToSign, envVars)
        : undefined,
      maxBodySize: request.auth.maxBodySize
        ? parseTemplateString(request.auth.maxBodySize, envVars)
        : undefined,
    })

    headers.push({
      active: true,
      key: "Authorization",
      value: authHeader,
      description: "",
    })
  }

  return headers
}

/**
 * Get headers that can be generated by body config of the request
 * @param req Request to check
 * @returns The list of headers
 */
export const getComputedBodyHeaders = (
  req:
    | HoppRESTRequest
    | {
        auth: HoppRESTAuth
        headers: HoppRESTHeaders
      }
): HoppRESTHeader[] => {
  // If a content-type is already defined, that will override this
  if (
    req.headers.find(
      (req) => req.active && req.key.toLowerCase() === "content-type"
    )
  )
    return []

  if (!("body" in req)) return []

  // Body should have a non-null content-type
  if (!req.body || req.body.contentType === null) return []

  if (
    req.body &&
    req.body.contentType === "application/octet-stream" &&
    req.body.body
  ) {
    const filename = req.body.body.name
    const fileType = req.body.body.type

    const contentType = fileType ? fileType : "application/octet-stream"

    return [
      {
        active: true,
        key: "content-type",
        value: contentType,
        description: "",
      },
      {
        active: true,
        key: "Content-Disposition",
        value: `attachment; filename="${filename}"`,
        description: "",
      },
    ]
  }

  return [
    {
      active: true,
      key: "content-type",
      value: req.body.contentType,
      description: "",
    },
  ]
}

export type ComputedHeader = {
  source: "auth" | "body"
  header: HoppRESTHeader
}

/**
 * Returns a list of headers that will be added during execution of the request
 * For e.g, Authorization headers maybe added if an Auth Mode is defined on REST
 * @param req The request to check
 * @param envVars The environment variables active
 * @param parse Whether to parse the template strings
 * @param showKeyIfSecret Whether to show the key if the value is a secret
 * @returns The headers that are generated along with the source of that header
 */
export const getComputedHeaders = async (
  req:
    | HoppRESTRequest
    | {
        auth: HoppRESTAuth
        headers: HoppRESTHeaders
      },
  envVars: Environment["variables"],
  parse = true,
  showKeyIfSecret = false
): Promise<ComputedHeader[]> => {
  return [
    ...(
      await getComputedAuthHeaders(
        envVars,
        req,
        undefined,
        parse,
        showKeyIfSecret
      )
    ).map((header) => ({
      source: "auth" as const,
      header,
    })),
    ...getComputedBodyHeaders(req).map((header) => ({
      source: "body" as const,
      header,
    })),
  ]
}

export type ComputedParam = {
  source: "auth"
  param: HoppRESTParam
}

/**
 * Returns a list of params that will be added during execution of the request
 * For e.g, Authorization params (like API-key) maybe added if an Auth Mode is defined on REST
 * @param req The request to check
 * @param envVars The environment variables active
 * @returns The params that are generated along with the source of that header
 */
export const getComputedParams = async (
  req: HoppRESTRequest,
  envVars: Environment["variables"]
): Promise<ComputedParam[]> => {
  // When this gets complex, its best to split this function off (like with getComputedHeaders)
  // API-key auth can be added to query params
  if (!req.auth || !req.auth.authActive) return []

  if (
    req.auth.authType !== "api-key" &&
    req.auth.authType !== "oauth-2" &&
    req.auth.authType !== "aws-signature"
  )
    return []

  if (req.auth.addTo !== "QUERY_PARAMS") return []

  if (req.auth.authType === "aws-signature") {
    const { addTo } = req.auth
    const params: ComputedParam[] = []
    if (addTo === "QUERY_PARAMS") {
      const currentDate = new Date()
      const amzDate = currentDate.toISOString().replace(/[:-]|\.\d{3}/g, "")

      const signer = new AwsV4Signer({
        method: req.method,
        datetime: amzDate,
        signQuery: true,
        accessKeyId: parseTemplateString(req.auth.accessKey, envVars),
        secretAccessKey: parseTemplateString(req.auth.secretKey, envVars),
        region: parseTemplateString(req.auth.region, envVars) ?? "us-east-1",
        service: parseTemplateString(req.auth.serviceName, envVars),
        sessionToken:
          req.auth.serviceToken &&
          parseTemplateString(req.auth.serviceToken, envVars),
        url: parseTemplateString(req.endpoint, envVars),
      })
      const sign = await signer.sign()

      for (const [k, v] of sign.url.searchParams) {
        params.push({
          source: "auth" as const,
          param: {
            active: true,
            key: k,
            value: v,
            description: "",
          },
        })
      }
    }
    return params
  }

  if (req.auth.authType === "api-key") {
    return [
      {
        source: "auth" as const,
        param: {
          active: true,
          key: parseTemplateString(req.auth.key, envVars, false, true),
          value: parseTemplateString(req.auth.value, envVars, false, true),
          description: "",
        },
      },
    ]
  }

  if (req.auth.authType === "oauth-2") {
    const { grantTypeInfo } = req.auth
    return [
      {
        source: "auth",
        param: {
          active: true,
          key: "access_token",
          value: parseTemplateString(grantTypeInfo.token, envVars),
          description: "",
        },
      },
    ]
  }
  return []
}

// Resolves environment variables in the body
export const resolvesEnvsInBody = (
  body: HoppRESTReqBody,
  env: Environment
): HoppRESTReqBody => {
  if (!body.contentType) return body

  if (body.contentType === "application/octet-stream") {
    return body
  }

  if (body.contentType === "multipart/form-data") {
    if (!body.body) {
      return {
        contentType: null,
        body: null,
      }
    }

    return {
      contentType: "multipart/form-data",
      body: body.body.map(
        (entry) =>
          <FormDataKeyValue>{
            active: entry.active,
            isFile: entry.isFile,
            key: parseTemplateString(entry.key, env.variables, false, true),
            value: entry.isFile
              ? entry.value
              : parseTemplateString(entry.value, env.variables, false, true),
            contentType: entry.contentType,
          }
      ),
    }
  }

  let bodyContent = ""

  if (isJSONContentType(body.contentType))
    bodyContent = stripComments(body.body)

  if (body.contentType === "application/x-www-form-urlencoded") {
    bodyContent = body.body
  }

  return {
    contentType: body.contentType,
    body: parseTemplateString(bodyContent, env.variables, false, true),
  }
}

function getFinalBodyFromRequest(
  request: HoppRESTRequest,
  envVariables: Environment["variables"],
  showKeyIfSecret = false
): FormData | Blob | string | null {
  if (request.body.contentType === null) return null

  if (request.body.contentType === "application/x-www-form-urlencoded") {
    const parsedBodyRecord = pipe(
      request.body.body ?? "",
      parseRawKeyValueEntriesE,
      E.map(
        flow(
          RA.toArray,
          /**
           * Filtering out empty keys and non-active pairs.
           */
          A.filter(({ active, key }) => active && !S.isEmpty(key)),

          /**
           * Mapping each key-value to template-string-parser with either on array,
           * which will be resolved in further steps.
           */
          A.map(({ key, value }) => [
            parseTemplateStringE(key, envVariables, false, showKeyIfSecret),
            parseTemplateStringE(value, envVariables, false, showKeyIfSecret),
          ]),

          /**
           * Filtering and mapping only right-eithers for each key-value as [string, string].
           */
          A.filterMap(([key, value]) =>
            E.isRight(key) && E.isRight(value)
              ? O.some([key.right, value.right] as [string, string])
              : O.none
          ),
          tupleWithSameKeysToRecord,
          (obj) => qs.stringify(obj, { indices: false })
        )
      )
    )
    return E.isRight(parsedBodyRecord) ? parsedBodyRecord.right : null
  }

  if (request.body.contentType === "multipart/form-data") {
    return pipe(
      request.body.body ?? [],
      A.filter(
        (x) =>
          x.key !== "" &&
          x.active &&
          (typeof x.value === "string" ||
            (x.value.length > 0 && x.value[0] instanceof File))
      ), // Remove empty keys and unsetted file

      // Sort files down
      arraySort((a, b) => {
        if (a.isFile) return 1
        if (b.isFile) return -1
        return 0
      }),

      // FormData allows only a single blob in an entry,
      // we split array blobs into separate entries (FormData will then join them together during exec)
      arrayFlatMap((x) =>
        x.isFile
          ? x.value.map((v) => ({
              key: parseTemplateString(x.key, envVariables),
              value: v as string | Blob,
              contentType: x.contentType,
            }))
          : [
              {
                key: parseTemplateString(x.key, envVariables),
                value: parseTemplateString(x.value, envVariables),
                contentType: x.contentType,
              },
            ]
      ),
      toFormData
    )
  }

  if (request.body.contentType === "application/octet-stream") {
    return request.body.body
  }

  let bodyContent = request.body.body ?? ""

  if (isJSONContentType(request.body.contentType))
    bodyContent = stripComments(request.body.body)

  // body can be null if the content-type is not set
  return parseBodyEnvVariables(bodyContent, envVariables)
}

/**
 * Outputs an executable request format with environment variables applied
 *
 * @param request The request to source from
 * @param environment The environment to apply
 * @param showKeyIfSecret Whether to show the key if the value is a secret
 *
 * @returns An object with extra fields defining a complete request
 */
export async function getEffectiveRESTRequest(
  request: HoppRESTRequest,
  environment: Environment,
  showKeyIfSecret = false
): Promise<EffectiveHoppRESTRequest> {
  const effectiveFinalHeaders = pipe(
    (await getComputedHeaders(request, environment.variables)).map(
      (h) => h.header
    ),
    A.concat(request.headers),
    A.filter((x) => x.active && x.key !== ""),
    A.map((x) => ({
      active: true,
      key: parseTemplateString(
        x.key,
        environment.variables,
        false,
        showKeyIfSecret
      ),
      value: parseTemplateString(
        x.value,
        environment.variables,
        false,
        showKeyIfSecret
      ),
      description: x.description,
    }))
  )

  const effectiveFinalParams = pipe(
    (await getComputedParams(request, environment.variables)).map(
      (p) => p.param
    ),
    A.concat(request.params),
    A.filter((x) => x.active && x.key !== ""),
    A.map((x) => ({
      active: true,
      key: parseTemplateString(
        x.key,
        environment.variables,
        false,
        showKeyIfSecret
      ),
      value: parseTemplateString(
        x.value,
        environment.variables,
        false,
        showKeyIfSecret
      ),
      description: x.description,
    }))
  )

  const effectiveFinalRequestVariables = pipe(
    request.requestVariables,
    A.filter((x) => x.active && x.key !== ""),
    A.map((x) => ({
      active: true,
      key: parseTemplateString(x.key, environment.variables),
      value: parseTemplateString(x.value, environment.variables),
    }))
  )

  const effectiveFinalBody = getFinalBodyFromRequest(
    request,
    environment.variables,
    showKeyIfSecret
  )

  return {
    ...request,
    effectiveFinalURL: parseTemplateString(
      request.endpoint,
      environment.variables,
      false,
      showKeyIfSecret
    ),
    effectiveFinalHeaders,
    effectiveFinalParams,
    effectiveFinalBody,
    effectiveFinalRequestVariables,
  }
}

/**
 * Creates an Observable Stream that emits HoppRESTRequests whenever
 * the input streams emit a value
 *
 * @param request$ The request stream containing request data
 * @param environment$ The environment stream containing environment data to apply
 *
 * @returns Observable Stream for the Effective Request Object
 */
export function getEffectiveRESTRequestStream(
  request$: Observable<HoppRESTRequest>,
  environment$: Observable<Environment>
): Observable<Promise<EffectiveHoppRESTRequest>> {
  return combineLatest([request$, environment$]).pipe(
    map(async ([request, env]) => await getEffectiveRESTRequest(request, env))
  )
}
