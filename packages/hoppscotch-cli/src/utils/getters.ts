import {
  Environment,
  HoppCollection,
  HoppRESTHeader,
  HoppRESTParam,
  parseTemplateStringE,
} from "@hoppscotch/data";
import axios, { AxiosError } from "axios";
import chalk from "chalk";
import * as A from "fp-ts/Array";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import * as S from "fp-ts/string";
import fs from "fs/promises";
import { round } from "lodash-es";

import { error } from "../types/errors";
import { DEFAULT_DURATION_PRECISION } from "./constants";
import { readJsonFile } from "./mutators";
import {
  WorkspaceCollection,
  WorkspaceEnvironment,
  transformWorkspaceCollection,
  transformWorkspaceEnvironment,
} from "./workspace-access";

type GetResourceContentsParams = {
  pathOrId: string;
  accessToken?: string;
  serverUrl?: string;
  resourceType: "collection" | "environment";
};

/**
 * Generates template string (status + statusText) with specific color unicodes
 * based on type of status.
 * @param status Status code of a HTTP response.
 * @param statusText Status text of a HTTP response.
 * @returns Template string with related color unicodes.
 */
export const getColorStatusCode = (
  status: number | string,
  statusText: string
): string => {
  const statusCode = `${status == 0 ? "Error" : status} : ${statusText}`;

  if (status.toString().startsWith("2")) {
    return chalk.greenBright(statusCode);
  } else if (status.toString().startsWith("3")) {
    return chalk.yellowBright(statusCode);
  }

  return chalk.redBright(statusCode);
};

/**
 * Replaces all template-string with their effective ENV values to generate effective
 * request headers/parameters meta-data.
 * @param metaData Headers/parameters on which ENVs will be applied.
 * @param environment Provides ENV variables for parsing template-string.
 * @returns Active, non-empty-key, parsed headers/parameters pairs.
 */
export const getEffectiveFinalMetaData = (
  metaData: HoppRESTHeader[] | HoppRESTParam[],
  environment: Environment
) =>
  pipe(
    metaData,

    /**
     * Selecting only non-empty and active pairs.
     */
    A.filter(({ key, active }) => !S.isEmpty(key) && active),
    A.map(({ key, value }) => ({
      active: true,
      key: parseTemplateStringE(key, environment.variables),
      value: parseTemplateStringE(value, environment.variables),
    })),
    E.fromPredicate(
      /**
       * Check if every key-value is right either. Else return HoppCLIError with
       * appropriate reason.
       */
      A.every(({ key, value }) => E.isRight(key) && E.isRight(value)),
      (reason) => error({ code: "PARSING_ERROR", data: reason })
    ),
    E.map(
      /**
       * Filtering and mapping only right-eithers for each key-value as [string, string].
       */
      A.filterMap(({ key, value }) =>
        E.isRight(key) && E.isRight(value)
          ? O.some({ active: true, key: key.right, value: value.right })
          : O.none
      )
    )
  );

/**
 * Reduces array of HoppRESTParam or HoppRESTHeader to unique key-value
 * pair.
 * @param metaData Array of meta-data to reduce.
 * @returns Object with unique key-value pair.
 */
export const getMetaDataPairs = (
  metaData: HoppRESTParam[] | HoppRESTHeader[]
) =>
  pipe(
    metaData,

    // Excluding non-active & empty key request meta-data.
    A.filter(({ active, key }) => active && !S.isEmpty(key)),

    // Reducing array of request-meta-data to key-value pair object.
    A.reduce(<Record<string, string>>{}, (target, { key, value }) =>
      Object.assign(target, { [`${key}`]: value })
    )
  );

/**
 * Object providing aliases for chalk color properties based on exceptions.
 */
export const exceptionColors = {
  WARN: chalk.yellow,
  INFO: chalk.blue,
  FAIL: chalk.red,
  SUCCESS: chalk.green,
  INFO_BRIGHT: chalk.blueBright,
  BG_WARN: chalk.bgYellow,
  BG_FAIL: chalk.bgRed,
  BG_INFO: chalk.bgBlue,
  BG_SUCCESS: chalk.bgGreen,
};

/**
 * Calculates duration in seconds for given end-HRTime of format [seconds, nanoseconds],
 * which is rounded-off upto given decimal value.
 * @param end Providing end-HRTime of format [seconds, nanoseconds].
 * @param precision Decimal precision to round-off float duration value (DEFAULT = 3).
 * @returns Rounded duration in seconds for given decimal precision.
 */
export const getDurationInSeconds = (
  end: [number, number],
  precision: number = DEFAULT_DURATION_PRECISION
) => {
  const durationInSeconds = (end[0] * 1e9 + end[1]) / 1e9;
  return round(durationInSeconds, precision);
};

export const roundDuration = (
  duration: number,
  precision: number = DEFAULT_DURATION_PRECISION
) => round(duration, precision);

/**
 * Retrieves the contents of a resource (collection or environment) from a local file (export) or a remote server (workspaces).
 *
 * @param {GetResourceContentsParams} params - The parameters for retrieving resource contents.
 * @param {string} params.pathOrId - The path to the local file or the ID for remote retrieval.
 * @param {string} [params.accessToken] - The access token for authorizing remote retrieval.
 * @param {string} [params.serverUrl] - The SH instance server URL for remote retrieval. Defaults to the cloud instance.
 * @param {"collection" | "environment"} params.resourceType - The type of the resource to retrieve.
 * @returns {Promise<HoppCollection | Environment>} A promise that resolves to the contents of the resource.
 * @throws Will throw an error if the content type of the fetched resource is not `application/json`,
 *         if there is an issue with the access token, if the server connection is refused,
 *         or if the server URL is invalid.
 */
export const getResourceContents = async (
  params: GetResourceContentsParams
): Promise<HoppCollection | Environment> => {
  const { pathOrId, accessToken, serverUrl, resourceType } = params;

  let contents: HoppCollection | Environment | null = null;
  let fileExistsInPath = false;

  try {
    await fs.access(pathOrId);
    fileExistsInPath = true;
  } catch (e) {
    fileExistsInPath = false;
  }

  if (accessToken && !fileExistsInPath) {
    try {
      const hostname = serverUrl || "https://api.hoppscotch.io";

      const separator = hostname.endsWith("/") ? "" : "/";
      const resourcePath =
        resourceType === "collection" ? "collection" : "environment";

      const url = `${hostname}${separator}v1/access-tokens/${resourcePath}/${pathOrId}`;

      const { data, headers } = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!headers["content-type"].includes("application/json")) {
        throw new AxiosError("INVALID_CONTENT_TYPE");
      }

      contents =
        resourceType === "collection"
          ? transformWorkspaceCollection(data as WorkspaceCollection)
          : transformWorkspaceEnvironment(data as WorkspaceEnvironment);
    } catch (err) {
      if (err instanceof AxiosError) {
        const axiosErr: AxiosError<{
          reason?: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "INVALID_ID";
          message: string;
          statusCode: number;
        }> = err;

        const errReason = axiosErr.response?.data?.reason;

        if (errReason) {
          throw error({
            code: errReason,
            data: ["TOKEN_EXPIRED", "TOKEN_INVALID"].includes(errReason)
              ? accessToken
              : pathOrId,
          });
        }

        if (axiosErr.code === "ECONNREFUSED") {
          throw error({ code: "SERVER_CONNECTION_REFUSED", data: serverUrl });
        }

        if (
          axiosErr.message === "INVALID_CONTENT_TYPE" ||
          axiosErr.code === "ERR_INVALID_URL" ||
          axiosErr.code === "ENOTFOUND" ||
          axiosErr.code === "ERR_BAD_REQUEST" ||
          axiosErr.response?.status === 404
        ) {
          throw error({ code: "INVALID_SERVER_URL", data: serverUrl });
        }
      } else {
        throw error({ code: "UNKNOWN_ERROR", data: err });
      }
    }
  }

  // Fallback to reading from file if contents are not available
  if (contents === null) {
    contents = (await readJsonFile(pathOrId, fileExistsInPath)) as
      | HoppCollection
      | Environment;
  }

  return contents;
};
