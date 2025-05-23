const path = require("path");
const fs = require("fs-extra");
const yaml = require("js-yaml");

/**
 * Read predefined Isolated Buffer that acts exactly as the NodeJs Buffer library to prevent access to external from the isolated sandbox
 */
const isoBuffer = fs.readFileSync(path.join(__dirname, "../../../..", "iso-libraries", "iso-buffer.js"), "utf8");

/**
 * Read the driver's signature from `driver.yaml`
 */
const driverYaml = yaml.load(fs.readFileSync(path.join(__dirname, "driver.yaml"), "utf8"));
const signature = driverYaml.signature;

/**
 * Validate if decodeDownlink function is defined in the driver
 * as some drivers may have encodeDownlink but no decodeDownlink
 * and there exist examples with legacy type "downlink" that should be wrapped only to "downlink-encode"
 */
const isDownlinkDecodeDefined = (() =>{
    const packageJson = fs.readJsonSync(path.join(__dirname, "package.json"));
    const driverFns = require("./" + packageJson.main);
    switch (signature){
        case "ttn":
        case "chirpstack":
            return false;
        case "lora-alliance":
        case "actility":
        default:
            let fn;
            if(typeof driverFns.driver === 'undefined' || typeof driverFns.driver.decodeUplink !== 'function') {
                fn = driverFns;
            } else {
                fn = driverFns.driver;
            }
            return typeof fn.decodeDownlink === 'function';

    }
})();

/**
 * Read the examples according to the signature of driver, wrap them if needed
 */
const examples = (() =>{
    // for default (lora-alliance) signature,
    // all examples are stored in one file on the root `examples.json`
    if(fs.pathExistsSync(path.join(__dirname, "examples.json"))){
        return fs.readJsonSync(path.join(__dirname, "examples.json"));
    }

    // for the rest of signature,
    // examples are stored in a separate folder, in one or several json files that ends with `.examples.json`
    // Get the list of files in the directory `examples`
    // The examples are stored in a legacy format
    // They should be wrapped

    if(!fs.pathExistsSync(path.join(__dirname, "examples"))){
        return [];
    }
    let examplesFiles = fs.readdirSync("examples");

    // Wrap and store all the examples in an array
    let examples = [];
    for (const exampleFile of examplesFiles) {
        if (exampleFile.endsWith(".examples.json")) {
            let neWExamples = fs.readJsonSync(path.join(__dirname, "examples", exampleFile));
            for(const example of neWExamples){
                if(example.type === "uplink"){
                    let wrappedExample = {
                        type: example.type,
                        description: example.description,
                        input: {
                            bytes: example.bytes,
                            fPort: example.fPort,
                            time: example.time,
                            thing: example.thing
                        },
                        output: example.data
                    }
                    examples.push(wrappedExample);
                } else if(example.type === "downlink"){
                    // map to downlink-decode examples only on drivers which have this function
                    if(isDownlinkDecodeDefined){
                        let wrappedDecodeDownlink = {
                            type: "downlink-decode",
                            description: example.description,
                            input: {
                                bytes: example.bytes,
                                fPort: example.fPort,
                                time: example.time,
                                thing: example.thing
                            },
                            output: example.data
                        }
                        examples.push(wrappedDecodeDownlink);
                    }

                    let wrappedEncodeDownlink = {
                        type: "downlink-encode",
                        description: example.description,
                        input: {
                            data: example.data,
                            fPort: example.fPort
                        },
                        output: {
                            bytes: example.bytes,
                            fPort: example.fPort,
                        }
                    }
                    examples.push(wrappedEncodeDownlink);
                }
            }
        }
    }
    return examples;
})();

/**
 * Read the legacy error examples if there is any
 */
const errors = (() =>{
    // error examples are stored in a separate folder, in one or several json files
    // Get the list of files in the directory `examples`

    if(!fs.pathExistsSync(path.join(__dirname, "errors"))){
        return [];
    }
    let errorFiles = fs.readdirSync("errors");

    // Storing all the error files in an array
    let errors = [];
    for (const errorFile of errorFiles) {
        if (errorFile.endsWith(".errors.json")) {
            errors = examples.concat(fs.readJsonSync(path.join(__dirname, "errors", errorFile)));
        }
    }
    return errors;
})();

/**
 * Read the functions call script according to the signature of driver
 */
const fnCall = (() => {
    let fnCallRef;
    switch (signature){
        case "actility":
            fnCallRef = "tpxFnCall.js";
            break;
        case "ttn":
            fnCallRef = "ttnFnCall.js";
            break;
        case "chirpstack":
            fnCallRef =  "chirpstackFnCall.js";
            break;
        case "lora-alliance":
        default:
            fnCallRef = "loraAllianceFnCall.js";
            break;
    }
    return fs.readFileSync(path.join(__dirname, "../../../..", "iso-libraries", fnCallRef), "utf8");
})();

/**
 * Read the driver code according to the main file specified in the npm package
 */
const code = (() => {
    const packageJson = fs.readJsonSync(path.join(__dirname, "package.json"));
    return fs.readFileSync(path.join(__dirname, packageJson.main), "utf8");
})();

/**
 * The script to be run
 */
const script = isoBuffer.concat("\n" + code).concat("\n" + fnCall);

/**
 * @param input : input from example to run the driver with
 * @param operation : operation to be operated on the input
 * @return result: output of the driver with the given input and operation
 */
async function run(input, operation){
    const codeToRun = `${script}; \nconst operation = '${operation}'; \nconst input = ${JSON.stringify(input)}; \ngetDriverEngineResult();`;
    return eval(codeToRun);
}


/**
 Test suites compatible with all driver types
 */

describe("Decode uplink", () => {
    examples.forEach((example) => {
        if (example.type === "uplink") {
            it(example.description, async () => {
                // Given
                const input = example.input;

                // Adaptation
                input.bytes = adaptBytesArray(input.bytes);

                // When
                const result = await run(input, "decodeUplink");

                // Then
                const expected = example.output;

                expect(result).toEqual(expected);
            });
        }
    });
});

describe("Decode downlink", () => {
    examples.forEach((example) => {
        if (example.type === "downlink-decode") {
            it(example.description, async () => {
                // Given
                const input = example.input;

                // Adaptation
                input.bytes = adaptBytesArray(input.bytes);

                // When
                const result = await run(input, "decodeDownlink");

                // Then
                const expected = example.output;

                // Then
                expect(result).toEqual(expected);
            });
        }
    });
});

describe("Encode downlink", () => {
    examples.forEach((example) => {
        if (example.type === "downlink-encode") {
            it(example.description, async () => {
                // Given
                const input = example.input;

                // When
                const result = await run(input, "encodeDownlink");

                // Then
                const expected = example.output;

                // Adaptation
                if(result.bytes){
                    result.bytes = adaptBytesArray(result.bytes);
                }
                if(expected.bytes){
                    expected.bytes = adaptBytesArray(expected.bytes);
                }

                expect(result).toEqual(expected);
            });
        }
    });
});

describe("Legacy Decode uplink errors", () => {
    errors.forEach((error) => {
        if (error.type === "uplink" && !error.data) {
            it(error.description, () => {
                // Given
                const input = {
                    bytes: adaptBytesArray(error.bytes),
                    fPort: error.fPort,
                    time: error.time
                };

                // When / Then
                const expected = error.error;
                expect(async () => await run(input, "decodeUplink").toThrow(expected));
            });
        }
    });
});

describe("Legacy Decode downlink errors", () => {
    errors.forEach((error) => {
        if (error.type === "uplink" && !error.data) {
            it(error.description, () => {
                // Given
                const input = {
                    bytes: adaptBytesArray(error.bytes),
                    fPort: error.fPort,
                    time: error.time
                };

                // When / Then
                const expected = error.error;
                expect(async () => await run(input, "decodeDownlink").toThrow(expected));
            });
        }
    });
});

describe("Legacy Encode downlink errors", () => {
    errors.forEach((error) => {
        if (error.type === "uplink" && error.data) {
            it(error.description, () => {
                // Given
                const input = error.data;

                // When / Then
                const expected = error.error;
                expect(async () => await run(input, "encodeDownlink").toThrow(expected));
            });
        }
    });
});

/**
 Utils used for unusual inputs
 */
function adaptBytesArray(bytes){
    // if the bytes in example are in hexadecimal format instead of array of integers
    if(typeof bytes === "string"){
        return Array.from(Buffer.from(bytes, "hex"));
    }
    return bytes;
}