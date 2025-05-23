'use strict';

const watt = require('gigawatts');

class Wim {
  constructor(imagexBin = null) {
    this._imagexBin = imagexBin ?? 'wimlib-imagex';
    this._xProcess = require('xcraft-core-process')();

    watt.wrapAll(this, '_spawn');
  }

  *_spawn(action, ...args) {
    const outputIsXml = args.includes('--xml');
    const next = args.pop();
    let output = '';
    /* HACK: Windows has a very poor support of encodings different of the
     * current set in the cmd (chcp). The wimlib-imagex command tries to
     * print the XML only in UTF16LE, but the buffer looks empty in this
     * case because wimlib-imagex can't write to stdout. Changing with chcp
     * works only partially. There are two ways in order to fix this problem.
     * (1) Pipe the output to a file
     * (2) Use UTF8 with nodejs and tries to clean the output
     * I decided to clean the output because I don't want a temporary
     * file just for this output.
     */
    const encoding =
      process.platform !== 'win32' && outputIsXml ? 'utf16le' : 'utf8';
    try {
      yield this._xProcess.spawn(
        this._imagexBin,
        [action, ...args],
        {encoding},
        next,
        (stdout) => (output += stdout)
      );
      /* HACK: Clean the xml output on windows because it's not UTF8 but a "malformed" UTF16LE */
      if (encoding === 'utf8' && outputIsXml) {
        output = output.substring(2);
        output = output.replace(new RegExp(output[1], 'g'), '');
      }
      return output;
    } catch (ex) {
      return ex;
    }
  }
  /**
   * Static method to build argument options for wimlib-imagex commands.
   *
   * @param {Object} options - The options for the command.
   * @param {string} [options.destDir] - The destination directory for the extracted files.
   * @param {boolean} [options.toStdout] - Whether to output to stdout, works only with files as input path
   * @param {boolean} [options.sourceList] - Whether to include a source list.
   * @param {string} [options.compress] - The compression type to use (e.g., 'none', 'fast', 'maximum').
   * @param {boolean} [options.noAcls] - Whether to exclude ACLs.
   * @param {boolean} [options.unixData] - Whether to include Unix data.
   * @param {boolean} [options.rebuild] - Whether to rebuild the WIM file.
   * @param {boolean} [options.check] - Whether to check the integrity of the WIM file.
   * @param {boolean} [options.noGlobs] - Whether to disable globbing.

   * @returns {string[]} - The constructed arguments.
   */
  static _argsOptionsBuilder(options) {
    const args = [];
    if (options.destDir) {
      args.push(`--dest-dir=${options.destDir}`);
    }
    if (options.toStdout) {
      args.push('--to-stdout');
    }
    if (options.sourceList) {
      args.push(`--source-list`);
    }
    if (options.compress) {
      args.push(`--compress=${options.compress}`);
    }
    if (options.noAcls) {
      args.push('--no-acls');
    }
    if (options.unixData) {
      args.push('--unix-data');
    }
    if (options.rebuild) {
      args.push('--rebuild');
    }
    if (options.check) {
      args.push('--check');
    }
    if (options.noGlobs) {
      args.push('--no-globs');
    }
    return args;
  }

  /**
   * Capture a new WIM
   *
   * wimlib-imagex capture
   *   <source>
   *   <outputWim>
   *   [options.image=1]
   *   [options.compress=none]
   *   [options.noAcls]
   *   [options.unixData]
   *   [options.rebuild]
   *   [options.check]
   *
   * @param {*} outputWim - Output WIM to create
   * @param {*} source - Source directory
   * @param {*} [options] - Options
   */
  async capture(outputWim, source, options = {}) {
    if (!options) {
      options = {};
    }

    const args = Wim._argsOptionsBuilder(options);
    await this._spawn('capture', source, outputWim, ...args);
  }

  /**
   * Extract a WIM
   *
   * wimlib-imagex extract
   *   <inputWim>
   *   <inputPath>
   *   [options.image=1]
   *   [options.noGlobs]
   *   [options.noAcls]
   *   [options.unixData]
   *   [options.check]
   *
   * @param {*} inputWim - WIM to extract
   * @param {*} inputPath - Input directory in the WIM
   * @param {*} [outputDir] - Output directory
   * @param {*} [options] - Options
   */
  async extract(inputWim, inputPath, outputDir, options = {}) {
    if (!options) {
      options = {};
    }
    if (!options.image) {
      options.image = 1;
    }
    if (outputDir) {
      options.destDir = outputDir;
    }

    const args = Wim._argsOptionsBuilder(options);
    return await this._spawn(
      'extract',
      inputWim,
      options.image,
      inputPath,
      ...args
    );
  }

  /**
   * Extract information in XML
   *
   * @param {*} inputWim - Input WIM
   * @returns {Object} the metadata
   */
  async info(inputWim) {
    const xml2js = require('xml2js');
    const xmlParser = new xml2js.Parser();

    const out = await this._spawn('info', '--xml', inputWim);
    if (!out || out.code) {
      throw new Error(`Cannot retrieve WIM metadata from ${inputWim}`);
    }
    return await xmlParser.parseStringPromise(out);
  }

  /**
   * Update a WIM
   *
   * wimlib-imagex update
   *   <inputWim>
   *   [options.image=1]
   *   [options.noAcls]
   *   [options.rebuild]
   *   [options.check]
   *   <command {type: add, input, output}>
   *
   * @param {*} inputWim - Input WIM to update
   * @param {*} command - The command (add, delete or rename)
   * @param {*} [options] - Options
   */
  async update(inputWim, command, options = {}) {
    if (!options) {
      options = {};
    }
    if (!options.image) {
      options.image = 1;
    }
    if (!command) {
      throw new Error('A command must be specified');
    }

    switch (command.type) {
      case 'add':
      case 'delete':
      case 'rename':
        command = `${command.type} "${command.input}" "${command.output}"`;
        break;
      default:
        throw new Error(`command ${command.type} not supported`);
    }

    const args = Wim._argsOptionsBuilder(options);
    await this._spawn('update', inputWim, options.image, command, ...args);
  }

  /**
   * Check the WIM integrity
   *
   * @param {*} inputWim - Input WIM
   */
  async verify(inputWim) {
    const out = await this._spawn('verify', inputWim);
    if (out.code) {
      throw new Error(`Integrity of ${inputWim} file seems compromised`);
    }
  }

  /**
   * List directories and files information from a WIM image.
   *
   * @param {string} inputWim - The path to the input WIM file.
   * @returns {Object} - The extracted metadata.
   */
  async dir(inputWim) {
    const out = await this._spawn('dir', inputWim);
    if (!out || out.code) {
      throw new Error(
        `Cannot retrieve WIM directories and files from ${inputWim}`
      );
    }
    return out;
  }
}

module.exports = Wim;
