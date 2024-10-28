import {ExecException} from "child_process";
import {afterAll, beforeAll, describe, expect, test} from "vitest";
import fs from "fs";
import path from "path";

import {HoppErrorCode} from "../../../types/errors";
import {getErrorCode, getErrorCodeFn, getTestJsonFilePath, runCLI, runCLIIteration} from "../../utils";


describe("hopp test [options] <file_path_or_id>", () => {
  const VALID_TEST_ARGS = `test ${getTestJsonFilePath("passes-coll.json", "collection")}`;

  describe("Test `hopp test <file_path_or_id>` command:", () => {
    describe("Argument parsing", () => {
      test("Errors with the code `INVALID_ARGUMENT` for not supplying enough arguments", async () => {
        const args = "test";
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });

      test("Errors with the code `INVALID_ARGUMENT` for an invalid command", async () => {
        const args = "invalid-arg";
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });
    });

    describe("Supplied collection export file validations", () => {
      test("Errors with the code `FILE_NOT_FOUND` if the supplied collection export file doesn't exist", async () => {
        const args = "test notfound.json";
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("FILE_NOT_FOUND");
      });

      test("Errors with the code UNKNOWN_ERROR if the supplied collection export file content isn't valid JSON", async () => {
        const args = `test ${getTestJsonFilePath("malformed-coll.json", "collection")}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("UNKNOWN_ERROR");
      });

      test("Errors with the code `MALFORMED_COLLECTION` if the supplied collection export file content is malformed", async () => {
        const args = `test ${getTestJsonFilePath("malformed-coll-2.json", "collection")}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("MALFORMED_COLLECTION");
      });

      test("Errors with the code `INVALID_FILE_TYPE` if the supplied collection export file doesn't end with the `.json` extension", async () => {
        const args = `test ${getTestJsonFilePath("notjson-coll.txt", "collection")}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_FILE_TYPE");
      });

      test("Fails if the collection file includes scripts with incorrect API usage and failed assertions", async () => {
        const args = `test ${getTestJsonFilePath("fails-coll.json", "collection")}`;
        const {error} = await runCLI(args);

        expect(error).not.toBeNull();
        expect(error).toMatchObject(<ExecException>{
          code: 1,
        });
      });
    });

    describe("Versioned entities", () => {
      describe("Collections & Requests", () => {
        const testFixtures = [
          {fileName: "coll-v1-req-v0.json", collVersion: 1, reqVersion: 0},
          {fileName: "coll-v1-req-v1.json", collVersion: 1, reqVersion: 1},
          {fileName: "coll-v2-req-v2.json", collVersion: 2, reqVersion: 2},
          {fileName: "coll-v2-req-v3.json", collVersion: 2, reqVersion: 3},
        ];

        testFixtures.forEach(({collVersion, fileName, reqVersion}) => {
          test(`Successfully processes a supplied collection export file where the collection is based on the "v${collVersion}" schema and the request following the "v${reqVersion}" schema`, async () => {
            const args = `test ${getTestJsonFilePath(fileName, "collection")}`;
            const {error} = await runCLI(args);

            expect(error).toBeNull();
          });
        });
      });

      describe("Environments", () => {
        const testFixtures = [
          {fileName: "env-v0.json", version: 0},
          {fileName: "env-v1.json", version: 1},
        ];

        testFixtures.forEach(({fileName, version}) => {
          test(`Successfully processes the supplied collection and environment export files where the environment is based on the "v${version}" schema`, async () => {
            const ENV_PATH = getTestJsonFilePath(fileName, "environment");
            const args = `test ${getTestJsonFilePath("sample-coll.json", "collection")} --env ${ENV_PATH}`;
            const {error} = await runCLI(args);

            expect(error).toBeNull();
          });
        });
      });
    });

    test("Successfully processes a supplied collection export file of the expected format", async () => {
      const args = `test ${getTestJsonFilePath("passes-coll.json", "collection")}`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    test("Successfully inherits/overrides authorization and headers specified at the root collection at deeply nested collections", async () => {
      const args = `test ${getTestJsonFilePath(
        "collection-level-auth-headers-coll.json",
        "collection"
      )}`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    test(
      "Successfully inherits/overrides authorization and headers at each level with multiple child collections",
      async () => {
        const args = `test ${getTestJsonFilePath(
          "multiple-child-collections-auth-headers-coll.json",
          "collection"
        )}`;
        const {error} = await runCLI(args);

        expect(error).toBeNull();
      },
      {timeout: 100000}
    );

    test("Persists environment variables set in the pre-request script for consumption in the test script", async () => {
      const args = `test ${getTestJsonFilePath(
        "pre-req-script-env-var-persistence-coll.json",
        "collection"
      )}`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    test("The `Content-Type` header takes priority over the value set at the request body", async () => {
      const args = `test ${getTestJsonFilePath(
        "content-type-header-scenarios.json",
        "collection"
      )}`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    describe("OAuth 2 Authorization type with Authorization Code Grant Type", () => {
      test("Successfully translates the authorization information to headers/query params and sends it along with the request", async () => {
        const args = `test ${getTestJsonFilePath(
          "oauth2-auth-code-coll.json",
          "collection"
        )}`;
        const {error} = await runCLI(args);

        expect(error).toBeNull();
      });
    });

    describe("multipart/form-data content type", () => {
      test("Successfully derives the relevant headers based and sends the form data in the request body", async () => {
        const args = `test ${getTestJsonFilePath(
          "oauth2-auth-code-coll.json",
          "collection"
        )}`;
        const {error} = await runCLI(args);

        expect(error).toBeNull();
      });
    });
    test("Ensures tests are running in sequence order based on folder name", async () => {
      const args = `test ${getTestJsonFilePath("multiple-child-collections-auth-headers-coll.json", "collection")}`;
      const {stdout, error} = await runCLI(args);

      // Extract folder names from the collection
      const expectedOrder = [
        "root-collection-request",
        "folder-1/folder-1-request",
        "folder-1/folder-11/folder-11-request",
        "folder-1/folder-12/folder-12-request",
        "folder-1/folder-13/folder-13-request",
        "folder-2/folder-2-request",
        "folder-2/folder-21/folder-21-request",
        "folder-2/folder-22/folder-22-request",
        "folder-2/folder-23/folder-23-request",
        "folder-3/folder-3-request",
        "folder-3/folder-31/folder-31-request",
        "folder-3/folder-32/folder-32-request",
        "folder-3/folder-33/folder-33-request"
      ];

      // Helper function to extract the running order from stdout
      const extractRunningOrder = (stdout: string): string[] => {
        const regex = /Running:.*?\/(.*?)\n/g;
        const matches = [];
        let match;
        while ((match = regex.exec(stdout)) !== null) {
          // Clean up the extracted folder name
          const cleanedMatch = match[1].replace(/\x1b\[\d+m/g, '');
          matches.push(cleanedMatch);
        }
        return matches;
      };

      // Extract the actual order from stdout
      const actualOrder = extractRunningOrder(stdout);

      // Verify the order of tests based on folder names
      expect(actualOrder).toStrictEqual(expectedOrder);

      expect(error).toBeNull();
    });
  });

  describe("Test `hopp test <file_path_or_id> --env <file_path_or_id>` command:", () => {
    describe("Supplied environment export file validations", () => {
      describe("Argument parsing", () => {
        test("Errors with the code `INVALID_ARGUMENT` if no file is supplied", async () => {
          const args = `${VALID_TEST_ARGS} --env`;
          const {stderr} = await runCLI(args);

          const out = getErrorCode(stderr);
          expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
        });
      });

      test("Errors with the code `INVALID_FILE_TYPE` if the supplied environment export file doesn't end with the `.json` extension", async () => {
        const args = `${VALID_TEST_ARGS} --env ${getTestJsonFilePath(
          "notjson-coll.txt",
          "collection"
        )}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_FILE_TYPE");
      });

      test("Errors with the code `FILE_NOT_FOUND` if the supplied environment export file doesn't exist", async () => {
        const args = `${VALID_TEST_ARGS} --env notfound.json`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("FILE_NOT_FOUND");
      });

      test("Errors with the code `MALFORMED_ENV_FILE` on supplying a malformed environment export file", async () => {
        const ENV_PATH = getTestJsonFilePath(
          "malformed-envs.json",
          "environment"
        );
        const args = `${VALID_TEST_ARGS} --env ${ENV_PATH}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("MALFORMED_ENV_FILE");
      });

      test("Errors with the code `BULK_ENV_FILE` on supplying an environment export file based on the bulk environment export format", async () => {
        const ENV_PATH = getTestJsonFilePath("bulk-envs.json", "environment");
        const args = `${VALID_TEST_ARGS} --env ${ENV_PATH}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("BULK_ENV_FILE");
      });
    });

    test("Successfully resolves values from the supplied environment export file", async () => {
      const TESTS_PATH = getTestJsonFilePath(
        "env-flag-tests-coll.json",
        "collection"
      );
      const ENV_PATH = getTestJsonFilePath("env-flag-envs.json", "environment");
      const args = `test ${TESTS_PATH} --env ${ENV_PATH}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    test("Successfully resolves environment variables referenced in the request body", async () => {
      const COLL_PATH = getTestJsonFilePath(
        "req-body-env-vars-coll.json",
        "collection"
      );
      const ENVS_PATH = getTestJsonFilePath(
        "req-body-env-vars-envs.json",
        "environment"
      );
      const args = `test ${COLL_PATH} --env ${ENVS_PATH}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    test("Works with short `-e` flag", async () => {
      const TESTS_PATH = getTestJsonFilePath(
        "env-flag-tests-coll.json",
        "collection"
      );
      const ENV_PATH = getTestJsonFilePath("env-flag-envs.json", "environment");
      const args = `test ${TESTS_PATH} -e ${ENV_PATH}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    describe(
      "Secret environment variables",
      () => {
        // Reads secret environment values from system environment
        test("Successfully picks the values for secret environment variables from `process.env` and persists the variables set from the pre-request script", async () => {
          const env = {
            ...process.env,
            secretBearerToken: "test-token",
            secretBasicAuthUsername: "test-user",
            secretBasicAuthPassword: "test-pass",
            secretQueryParamValue: "secret-query-param-value",
            secretBodyValue: "secret-body-value",
            secretHeaderValue: "secret-header-value",
          };

          const COLL_PATH = getTestJsonFilePath(
            "secret-envs-coll.json",
            "collection"
          );
          const ENVS_PATH = getTestJsonFilePath(
            "secret-envs.json",
            "environment"
          );
          const args = `test ${COLL_PATH} --env ${ENVS_PATH}`;

          const {error, stdout} = await runCLI(args, {env});

          expect(stdout).toContain(
            "https://httpbin.org/basic-auth/*********/*********"
          );
          expect(error).toBeNull();
        });

        // Prefers values specified in the environment export file over values set in the system environment
        test("Successfully picks the values for secret environment variables set directly in the environment export file and persists the environment variables set from the pre-request script", async () => {
          const COLL_PATH = getTestJsonFilePath(
            "secret-envs-coll.json",
            "collection"
          );
          const ENVS_PATH = getTestJsonFilePath(
            "secret-supplied-values-envs.json",
            "environment"
          );
          const args = `test ${COLL_PATH} --env ${ENVS_PATH}`;

          const {error, stdout} = await runCLI(args);

          expect(stdout).toContain(
            "https://httpbin.org/basic-auth/*********/*********"
          );
          expect(error).toBeNull();
        });

        // Values set from the scripting context takes the highest precedence
        test("Setting values for secret environment variables from the pre-request script overrides values set at the supplied environment export file", async () => {
          const COLL_PATH = getTestJsonFilePath(
            "secret-envs-persistence-coll.json",
            "collection"
          );
          const ENVS_PATH = getTestJsonFilePath(
            "secret-supplied-values-envs.json",
            "environment"
          );
          const args = `test ${COLL_PATH} --env ${ENVS_PATH}`;

          const {error, stdout} = await runCLI(args);

          expect(stdout).toContain(
            "https://httpbin.org/basic-auth/*********/*********"
          );
          expect(error).toBeNull();
        });

        test("Persists secret environment variable values set from the pre-request script for consumption in the request and post-request script context", async () => {
          const COLL_PATH = getTestJsonFilePath(
            "secret-envs-persistence-scripting-coll.json",
            "collection"
          );
          const ENVS_PATH = getTestJsonFilePath(
            "secret-envs-persistence-scripting-envs.json",
            "environment"
          );

          const args = `test ${COLL_PATH} --env ${ENVS_PATH}`;

          const {error} = await runCLI(args);
          expect(error).toBeNull();
        });
      },
      {timeout: 50000}
    );

    describe("Request variables", () => {
      test("Picks active request variables and ignores inactive entries", async () => {
        const COLL_PATH = getTestJsonFilePath(
          "request-vars-coll.json",
          "collection"
        );

        const args = `test ${COLL_PATH}`;

        const {error} = await runCLI(args);
        expect(error).toBeNull();
      });

      test("Supports the usage of request variables along with environment variables", async () => {
        const env = {
          ...process.env,
          secretBasicAuthPasswordEnvVar: "password",
        };

        const COLL_PATH = getTestJsonFilePath(
          "request-vars-coll.json",
          "collection"
        );
        const ENVS_PATH = getTestJsonFilePath(
          "request-vars-envs.json",
          "environment"
        );

        const args = `test ${COLL_PATH} --env ${ENVS_PATH}`;

        const {error, stdout} = await runCLI(args, {env});
        expect(stdout).toContain(
          "https://echo.hoppscotch.io/********/********"
        );
        expect(error).toBeNull();
      });
    });

    describe("AWS Signature Authorization type", () => {
      test("Successfully translates the authorization information to headers/query params and sends it along with the request", async () => {
        const env = {
          ...process.env,
          secretKey: "test-secret-key",
          serviceToken: "test-token",
        };

        const COLL_PATH = getTestJsonFilePath(
          "aws-signature-auth-coll.json",
          "collection"
        );
        const ENVS_PATH = getTestJsonFilePath(
          "aws-signature-auth-envs.json",
          "environment"
        );

        const args = `test ${COLL_PATH} -e ${ENVS_PATH}`;
        const {error} = await runCLI(args, {env});

        expect(error).toBeNull();
      });
    });
  });

  describe("Test `hopp test <file_path_or_id> --delay <delay_in_ms>` command:", () => {
    describe("Argument parsing", () => {
      test("Errors with the code `INVALID_ARGUMENT` on not supplying a delay value", async () => {
        const args = `${VALID_TEST_ARGS} --delay`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });

      test("Errors with the code `INVALID_ARGUMENT` on supplying an invalid delay value", async () => {
        const args = `${VALID_TEST_ARGS} --delay 'NaN'`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });
    });

    test("Successfully performs delayed request execution for a valid delay value", async () => {
      const args = `${VALID_TEST_ARGS} --delay 1`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    test("Works with the short `-d` flag", async () => {
      const args = `${VALID_TEST_ARGS} -d 1`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });
  });

  // Future TODO: Enable once a proper e2e test environment is set up locally
  describe.skip("Test `hopp test <file_path_or_id> --env <file_path_or_id> --token <access_token> --server <server_url>` command:", () => {
    const {
      REQ_BODY_ENV_VARS_COLL_ID,
      COLLECTION_LEVEL_HEADERS_AUTH_COLL_ID,
      REQ_BODY_ENV_VARS_ENVS_ID,
      PERSONAL_ACCESS_TOKEN,
    } = process.env;

    if (
      !REQ_BODY_ENV_VARS_COLL_ID ||
      !COLLECTION_LEVEL_HEADERS_AUTH_COLL_ID ||
      !REQ_BODY_ENV_VARS_ENVS_ID ||
      !PERSONAL_ACCESS_TOKEN
    ) {
      return;
    }

    const SERVER_URL = "https://stage-shc.hoppscotch.io/backend";

    describe("Argument parsing", () => {
      test("Errors with the code `INVALID_ARGUMENT` on not supplying a value for the `--token` flag", async () => {
        const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --token`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });

      test("Errors with the code `INVALID_ARGUMENT` on not supplying a value for the `--server` flag", async () => {
        const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --server`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });
    });

    describe("Workspace access validations", () => {
      const INVALID_COLLECTION_ID = "invalid-coll-id";
      const INVALID_ENVIRONMENT_ID = "invalid-env-id";
      const INVALID_ACCESS_TOKEN = "invalid-token";

      test("Errors with the code `TOKEN_INVALID` if the supplied access token is invalid", async () => {
        const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --token ${INVALID_ACCESS_TOKEN} --server ${SERVER_URL}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("TOKEN_INVALID");
      });

      test("Errors with the code `INVALID_ID` if the supplied collection ID is invalid", async () => {
        const args = `test ${INVALID_COLLECTION_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${SERVER_URL}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ID");
      });

      test("Errors with the code `INVALID_ID` if the supplied environment ID is invalid", async () => {
        const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --env ${INVALID_ENVIRONMENT_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${SERVER_URL}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ID");
      });

      test("Errors with the code `INVALID_SERVER_URL` if not supplying a valid SH instance server URL", async () => {
        // FE URL of the staging SHC instance
        const INVALID_SERVER_URL = "https://stage-shc.hoppscotch.io";
        const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --env ${REQ_BODY_ENV_VARS_ENVS_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${INVALID_SERVER_URL}`;

        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_SERVER_URL");
      });

      test("Errors with the code `SERVER_CONNECTION_REFUSED` if supplying an SH instance server URL that doesn't follow URL semantics", async () => {
        const INVALID_URL = "invalid-url";
        const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --env ${REQ_BODY_ENV_VARS_ENVS_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${INVALID_URL}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("SERVER_CONNECTION_REFUSED");
      });
    });

    test("Successfully retrieves a collection with the ID", async () => {
      const args = `test ${COLLECTION_LEVEL_HEADERS_AUTH_COLL_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${SERVER_URL}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    test("Successfully retrieves collections and environments from a workspace using their respective IDs", async () => {
      const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --env ${REQ_BODY_ENV_VARS_ENVS_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${SERVER_URL}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    test("Supports specifying collection file path along with environment ID", async () => {
      const TESTS_PATH = getTestJsonFilePath(
        "req-body-env-vars-coll.json",
        "collection"
      );
      const args = `test ${TESTS_PATH} --env ${REQ_BODY_ENV_VARS_ENVS_ID} --token ${PERSONAL_ACCESS_TOKEN} --server ${SERVER_URL}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    test("Supports specifying environment file path along with collection ID", async () => {
      const ENV_PATH = getTestJsonFilePath(
        "req-body-env-vars-envs.json",
        "environment"
      );
      const args = `test ${REQ_BODY_ENV_VARS_COLL_ID} --env ${ENV_PATH} --token ${PERSONAL_ACCESS_TOKEN} --server ${SERVER_URL}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });

    test("Supports specifying both collection and environment file paths", async () => {
      const TESTS_PATH = getTestJsonFilePath(
        "req-body-env-vars-coll.json",
        "collection"
      );
      const ENV_PATH = getTestJsonFilePath(
        "req-body-env-vars-envs.json",
        "environment"
      );
      const args = `test ${TESTS_PATH} --env ${ENV_PATH} --token ${PERSONAL_ACCESS_TOKEN}`;

      const {error} = await runCLI(args);
      expect(error).toBeNull();
    });
  });

  describe("Test`hopp test <file_path_or_id> --env <file_path_or_id> --reporter-junit [path]", () => {
    const genPath = path.resolve("hopp-cli-test");

    // Helper function to replace dynamic values before generating test snapshots
    // Currently scoped to JUnit report generation
    const replaceDynamicValuesInStr = (input: string): string =>
      input.replace(
        /(time|timestamp)="[^"]+"/g,
        (_, attr) => `${attr}="${attr}"`
      );

    beforeAll(() => {
      fs.mkdirSync(genPath);
    });

    afterAll(() => {
      fs.rmdirSync(genPath, {recursive: true});
    });

    test("Report export fails with the code `REPORT_EXPORT_FAILED` while encountering an error during path creation", async () => {
      const exportPath = "hopp-junit-report.xml";

      const COLL_PATH = getTestJsonFilePath("passes-coll.json", "collection");

      const args = `test ${COLL_PATH} --reporter-junit /non-existent-path/report.xml`;

      const {stdout, stderr} = await runCLI(args, {
        cwd: path.resolve("hopp-cli-test"),
      });

      const out = getErrorCode(stderr);
      expect(out).toBe<HoppErrorCode>("REPORT_EXPORT_FAILED");

      expect(stdout).not.toContain(
        `Successfully exported the JUnit report to: ${exportPath}`
      );
    });

    test("Generates a JUnit report at the default path", async () => {
      const exportPath = "hopp-junit-report.xml";

      const COLL_PATH = getTestJsonFilePath(
        "test-junit-report-export-coll.json",
        "collection"
      );

      const args = `test ${COLL_PATH} --reporter-junit`;

      const {stdout} = await runCLI(args, {
        cwd: path.resolve("hopp-cli-test"),
      });

      expect(stdout).not.toContain(
        `Overwriting the pre-existing path: ${exportPath}`
      );

      expect(stdout).toContain(
        `Successfully exported the JUnit report to: ${exportPath}`
      );

      const fileContents = fs
        .readFileSync(path.resolve(genPath, exportPath))
        .toString();

      expect(replaceDynamicValuesInStr(fileContents)).toMatchSnapshot();
    });

    test("Generates a JUnit report at the specified path", async () => {
      const exportPath = "outer-dir/inner-dir/report.xml";

      const COLL_PATH = getTestJsonFilePath(
        "test-junit-report-export-coll.json",
        "collection"
      );

      const args = `test ${COLL_PATH} --reporter-junit ${exportPath}`;

      const {stdout} = await runCLI(args, {
        cwd: path.resolve("hopp-cli-test"),
      });

      expect(stdout).not.toContain(
        `Overwriting the pre-existing path: ${exportPath}`
      );

      expect(stdout).toContain(
        `Successfully exported the JUnit report to: ${exportPath}`
      );

      const fileContents = fs
        .readFileSync(path.resolve(genPath, exportPath))
        .toString();

      expect(replaceDynamicValuesInStr(fileContents)).toMatchSnapshot();
    });

    test("Generates a JUnit report for a collection with authorization/headers set at the collection level", async () => {
      const exportPath = "hopp-junit-report.xml";

      const COLL_PATH = getTestJsonFilePath(
        "collection-level-auth-headers-coll.json",
        "collection"
      );

      const args = `test ${COLL_PATH} --reporter-junit`;

      const {stdout} = await runCLI(args, {
        cwd: path.resolve("hopp-cli-test"),
      });

      expect(stdout).toContain(
        `Overwriting the pre-existing path: ${exportPath}`
      );

      expect(stdout).toContain(
        `Successfully exported the JUnit report to: ${exportPath}`
      );

      const fileContents = fs
        .readFileSync(path.resolve(genPath, exportPath))
        .toString();

      expect(replaceDynamicValuesInStr(fileContents)).toMatchSnapshot();
    });

    test("Generates a JUnit report for a collection referring to environment variables", async () => {
      const exportPath = "hopp-junit-report.xml";

      const COLL_PATH = getTestJsonFilePath(
        "req-body-env-vars-coll.json",
        "collection"
      );
      const ENV_PATH = getTestJsonFilePath(
        "req-body-env-vars-envs.json",
        "environment"
      );

      const args = `test ${COLL_PATH} --env ${ENV_PATH} --reporter-junit`;

      const {stdout} = await runCLI(args, {
        cwd: path.resolve("hopp-cli-test"),
      });

      expect(stdout).toContain(
        `Overwriting the pre-existing path: ${exportPath}`
      );

      expect(stdout).toContain(
        `Successfully exported the JUnit report to: ${exportPath}`
      );

      const fileContents = fs
        .readFileSync(path.resolve(genPath, exportPath))
        .toString();

      expect(replaceDynamicValuesInStr(fileContents)).toMatchSnapshot();
    });

  });

  describe("Test `hopp test <file> --iterations <iterations_in_ms>` command:", () => {
    const VALID_TEST_ARGS = `test ${getTestJsonFilePath("passes-coll.json", "collection")}`;

    test("Errors with the code `INVALID_ARGUMENT` on not supplying a iterations value", async () => {
      const args = `${VALID_TEST_ARGS} --iterations`;
      const {stderr} = await runCLI(args);

      const out = getErrorCode(stderr);
      expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
    });

    test("Errors with the code `INVALID_ARGUMENT` on supplying an invalid iteration value", async () => {
      const args = `${VALID_TEST_ARGS} --iterations 'NaN'`;
      try {
        await runCLIIteration(args);
      } catch (error) {
        if (error instanceof Error) {
          const errorCode = getErrorCodeFn(error.message);
          expect(errorCode).toBe("INVALID_ARGUMENT");
        }
      }
    });


    test("Successfully performs iteration request execution for a valid iteration value", async () => {
      const args = `${VALID_TEST_ARGS} --iterations 1`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    test("Works with the short `-i` flag", async () => {
      const args = `${VALID_TEST_ARGS} -i 1`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });
  });

  describe("Test `hopp test <file> --data <file>` command:", () => {
    describe("Supplied data export file validations", () => {
      const VALID_TEST_ARGS = `test ${getTestJsonFilePath("data-envs.csv", "collection")}`;
      const dataFilePath = `${VALID_TEST_ARGS} --data notfound.csv`;

      test("Errors with the code `INVALID_ARGUMENT` if no file is supplied", async () => {
        const args = `${VALID_TEST_ARGS} --data`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_ARGUMENT");
      });

      test("Errors with the code `INVALID_FILE_TYPE` if the supplied environment export file doesn't end with the `.csv` extension", async () => {
        const args = `${VALID_TEST_ARGS} --data ${getTestJsonFilePath(
          "notjson-coll.txt",
          "collection"
        )}`;
        const {stderr} = await runCLI(args);

        const out = getErrorCode(stderr);
        expect(out).toBe<HoppErrorCode>("INVALID_FILE_TYPE");
      });

      test("Errors with the code `FILE_NOT_FOUND` if the supplied data export file doesn't exist", async () => {
        const args = dataFilePath;

        // Expect the function to throw an error and log the error message
        try {
          await runCLI(args);
        } catch (error) {
          if (error instanceof Error) {
            console.log(error.message);
            expect(error.message).toBe("FILE_NOT_FOUND");
          }
        }
      });
    });

    test("Successfully resolves values from the supplied data export file", async () => {
      const TESTS_PATH = getTestJsonFilePath(
        "env-flag-tests-coll.json",
        "collection"
      );
      const ENV_PATH = getTestJsonFilePath("data-envs.csv", "environment");
      const args = `test ${TESTS_PATH} --data ${ENV_PATH}`;

      const {error} = await runCLI(args);

      expect(error).toBeNull();
    });

    test("Successfully resolves data variables referenced in the request body", async () => {
      const COLL_PATH = getTestJsonFilePath(
        "req-body-env-vars-coll.json",
        "collection"
      );
      const ENVS_PATH = getTestJsonFilePath(
        "data-envs.csv",
        "environment"
      );
      const args = `test ${COLL_PATH} --data ${ENVS_PATH}`;
      const {error} = await runCLI(args);

      expect(error).toBeNull();

    });

    test("Works with shorth `-data` flag", async () => {
      const TESTS_PATH = getTestJsonFilePath(
        "env-flag-tests-coll.json",
        "collection"
      );
      const ENV_PATH = getTestJsonFilePath("data-envs.csv", "environment");

      const args = `test ${TESTS_PATH} -data ${ENV_PATH}`;
      console.log("args.."+args)
      try {
        const { stdout, stderr, error } = await runCLI(args);
        console.log('stdout:', stdout);
        console.log('stderr:', stderr);
        expect(error).toBeNull();
      } catch (error) {
        console.error('Error:', error);
        throw error;
      }
    });
  });
});
