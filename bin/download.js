/**
 * @file Google スプレッドシートのデータをダウンロードする
 */

const fs = require("fs");
const path = require("path")
const util = require('util')
const stream = require('stream')
const fetch = require("node-fetch")
const csv = require("csv-parse")

const promisePipeline = util.promisify(stream.pipeline)

const GOOGLE_SHEET_SPOT_URL = process.env["GOOGLE_SHEET_SPOT_URL"];
const GOOGLE_SHEET_BASIC_URL = process.env["GOOGLE_SHEET_BASIC_URL"];

const zen2han = (str) => {
  return str.replace(/[！-～]/g, function (s) {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  }).replace(/　/g, ' ');
}

const table2json = (table) => {

  const header = table.values[0]
  let records = table.values.slice(1)

  // データが空の時に、空の配列を返す
  if (records.length === 0) {
    records = Array(header.length).fill('');
  }

  const features = records.map((record) => {

    const properties = header.reduce((prev, column) => {
      const value = record[header.indexOf(column)] || '';
      prev[column] = zen2han(value || '');
      return prev;
    }, {});
    return properties;
  });

  return features[0]
}

const downloadLogo = async (logo_image_url) => {

  const distLogoFilePath = path.join(process.cwd(), "/public/logo.svg");

  // スプレッドシートのデータをダウンロードする

  try {

    const res = await fetch(logo_image_url);
    const svg = await res.text();
    fs.writeFileSync(distLogoFilePath, svg);

  } catch (error) {

    console.log(error)
    process.stderr.write(
      `ロゴ画像のダウンロードに失敗しました。正しいURLか確認して下さい。\n`
    );
    process.exit(1);

  }

}

const fetchCsv = async (sheet_url, numCols) => {
  const cols = typeof numCols === "undefined" ? 10 : numCols
  const u = new URL(sheet_url)
  const spread_sheet_id = path.basename(path.dirname(u.pathname))
  const sheet_id = u.hash.split("=")[1]

  const export_base = new URL(
    path.join("/", "spreadsheets", "d", spread_sheet_id, "export"),
    "https://docs.google.com"
  )
  const export_query = new URLSearchParams({ format: "csv", gid: sheet_id })
  const export_url = `${export_base.toString()}?${export_query.toString()}`

  const parser = csv.parse({})
  const records = []
  parser.on("readable", function () {
    let record
    while ((record = parser.read()) !== null) {
      record = record.slice(0, cols)
      if (record.some((col) => col !== "")) {
        for (let i = record.length - 1; i >= 0 && record[i] === ""; i--) {
          record.pop()
        }
        records.push(record)
      }
    }
  })

  const res = await fetch(export_url)
  await promisePipeline(res.body, parser)
  return records
}

const fetchDataSetEnv = async () => {

  // 引数に Google Sheet API key が指定されてなければ終了。
  if (!GOOGLE_SHEET_SPOT_URL || !GOOGLE_SHEET_BASIC_URL) {

    process.stderr.write(
      `環境変数 "GOOGLE_SHEET_SPOT_URL" と "GOOGLE_SHEET_BASIC_URL" を指定して下さい。\n`
    );

    process.exit(1);
  }

  const sheetList = [
    {
      name: "スポットデータ",
      exportFilePath: "/public/data.json",
      sheetUrl: GOOGLE_SHEET_SPOT_URL
    },
    {
      name: "基本データ",
      exportFilePath: "/src/config.json",
      sheetUrl: GOOGLE_SHEET_BASIC_URL
    },
  ]

  let config;

  for (let i = 0; i < sheetList.length; i++) {
    const sheet = sheetList[i];

    try {
      config = {
        values: await fetchCsv(sheet.sheetUrl)
      }

      if (sheet.name === "基本データ") {
        // ヘッダーをキーとしたJSONに変換する
        config = table2json(config);
      }

      // SVG 形式のロゴ画像が指定されていればダウンロードする
      if (config.logo_image_url && config.logo_image_url.match(/\.svg|\.SVG/)) {

        await downloadLogo(config.logo_image_url);

      }

    } catch (error) {

      console.log(error)
      process.stderr.write(
        `スプレッドシートのダウンロードに失敗しました。URLと閲覧権限が正しく設定されている事を確認して下さい。\n`
      );
      process.exit(1);
    }

    fs.writeFileSync(path.join(process.cwd(), sheet.exportFilePath), JSON.stringify(config, null, 2));

  }

  process.exit(0);

}

fetchDataSetEnv();
