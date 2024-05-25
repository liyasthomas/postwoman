import { Environment } from "@hoppscotch/data";
import { entityReference } from "verzod";
import { z } from "zod";

import { TestCmdOptionsWithRequiredEnv } from "../../types/commands";
import { error } from "../../types/errors";
import {
  HoppEnvKeyPairObject,
  HoppEnvPair,
  HoppEnvs,
} from "../../types/request";
import { getResourceContents } from "../../utils/getters";

/**
 * Parses env json file for given path and validates the parsed env json object
 * @param pathOrId Path of env.json file to be parsed
 * @param [options] Supplied values for CLI flags
 * @param [options.accessToken] Personal access token to fetch workspace environments
 * @param [options.serverUrl] server URL for SH instance
 * @returns For successful parsing we get HoppEnvs object
 */
export async function parseEnvsData(options: TestCmdOptionsWithRequiredEnv) {
  const { env: pathOrId, token: accessToken, server: serverUrl } = options;

  const contents = (await getResourceContents({
    pathOrId,
    accessToken,
    serverUrl,
    resourceType: "environment",
  })) as Environment;

  const envPairs: Array<HoppEnvPair | Record<string, string>> = [];

  // The legacy key-value pair format that is still supported
  const HoppEnvKeyPairResult = HoppEnvKeyPairObject.safeParse(contents);

  // Shape of the single environment export object that is exported from the app
  const HoppEnvExportObjectResult = Environment.safeParse(contents);

  // Shape of the bulk environment export object that is exported from the app
  const HoppBulkEnvExportObjectResult = z
    .array(entityReference(Environment))
    .safeParse(contents);

  // CLI doesnt support bulk environments export
  // Hence we check for this case and throw an error if it matches the format
  if (HoppBulkEnvExportObjectResult.success) {
    throw error({ code: "BULK_ENV_FILE", path: pathOrId, data: error });
  }

  //  Checks if the environment file is of the correct format
  // If it doesnt match either of them, we throw an error
  if (
    !HoppEnvKeyPairResult.success &&
    HoppEnvExportObjectResult.type === "err"
  ) {
    throw error({ code: "MALFORMED_ENV_FILE", path: pathOrId, data: error });
  }

  if (HoppEnvKeyPairResult.success) {
    for (const [key, value] of Object.entries(HoppEnvKeyPairResult.data)) {
      envPairs.push({ key, value, secret: false });
    }
  } else if (HoppEnvExportObjectResult.type === "ok") {
    envPairs.push(...HoppEnvExportObjectResult.value.variables);
  }

  return <HoppEnvs>{ global: [], selected: envPairs };
}
