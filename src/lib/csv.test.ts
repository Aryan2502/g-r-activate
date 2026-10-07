import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CSV_BOM,
  buildCsv,
  csvBoolean,
  csvCode,
  csvDate,
  csvDateTime,
  csvDecimal,
  csvFileName,
  csvInteger,
  csvText,
  downloadCsv,
  escapeCsvField,
  type CsvColumn,
} from "./csv";

describe("csvDecimal()", () => {
  it("writes a decimal comma without thousands separators", () => {
    expect(csvDecimal(1234.5)).toBe("1234,50");
    expect(csvDecimal("1234567.891")).toBe("1234567,89");
    expect(csvDecimal(0)).toBe("0,00");
    expect(csvDecimal(12.5, 1)).toBe("12,5");
    expect(csvDecimal(7, 0)).toBe("7");
  });

  it("rounds half away from zero, like the database", () => {
    expect(csvDecimal(1.005)).toBe("1,01");
    expect(csvDecimal(6.765)).toBe("6,77");
    expect(csvDecimal(-12.345)).toBe("-12,35");
    expect(csvDecimal(-0.001)).toBe("0,00");
  });

  it("leaves blanks and non-numbers empty", () => {
    expect(csvDecimal(null)).toBe("");
    expect(csvDecimal(undefined)).toBe("");
    expect(csvDecimal("")).toBe("");
    expect(csvDecimal("abc")).toBe("");
    expect(csvDecimal(Number.NaN)).toBe("");
  });
});

describe("csvInteger()", () => {
  it("writes whole numbers", () => {
    expect(csvInteger(12)).toBe("12");
    expect(csvInteger("3")).toBe("3");
    expect(csvInteger(2.5)).toBe("3");
    expect(csvInteger(null)).toBe("");
  });
});

describe("csvDate() / csvDateTime()", () => {
  it("prints a Postgres date as dd-mm-jjjj, unchanged", () => {
    expect(csvDate("2026-10-07")).toBe("07-10-2026");
    expect(csvDate("2026-01-31")).toBe("31-01-2026");
  });

  it("prints an instant as its Suriname date (UTC−3)", () => {
    // 02:30 UTC on 8 October is still 7 October in Paramaribo.
    expect(csvDate("2026-10-08T02:30:00Z")).toBe("07-10-2026");
    expect(csvDateTime("2026-10-08T02:30:00Z")).toBe("07-10-2026 23:30");
    expect(csvDateTime("2026-10-07T12:05:00+00:00")).toBe("07-10-2026 09:05");
  });

  it("leaves blanks and garbage empty instead of throwing", () => {
    expect(csvDate(null)).toBe("");
    expect(csvDate("")).toBe("");
    expect(csvDate("geen datum")).toBe("");
    expect(csvDate(42)).toBe("");
    expect(csvDateTime(undefined)).toBe("");
    expect(csvDateTime("nope")).toBe("");
  });
});

describe("csvBoolean()", () => {
  it("writes ja / nee", () => {
    expect(csvBoolean(true)).toBe("ja");
    expect(csvBoolean(false)).toBe("nee");
    expect(csvBoolean(null)).toBe("");
  });
});

describe("csvText()", () => {
  it("keeps ordinary text as it is", () => {
    expect(csvText("Maria Pinas")).toBe("Maria Pinas");
    expect(csvText("Énéas €")).toBe("Énéas €");
    expect(csvText(null)).toBe("");
  });

  it("defuses text Excel would run as a formula (CSV injection)", () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")');
    expect(csvText("+31 6 1234")).toBe("'+31 6 1234");
    expect(csvText("-2+3")).toBe("'-2+3");
    expect(csvText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvText("\t=1")).toBe("'\t=1");
    expect(csvText("a=b")).toBe("a=b");
  });

  it("writes objects as JSON", () => {
    expect(csvText({ status: "paid", amount: 12.5 })).toBe('{"status":"paid","amount":12.5}');
    expect(csvText(["a", "b"])).toBe('["a","b"]');
  });
});

describe("csvCode()", () => {
  it("keeps long digit strings, leading zeros and phone numbers as text", () => {
    expect(csvCode("9400111899223397658538")).toBe('="9400111899223397658538"');
    expect(csvCode("00123")).toBe('="00123"');
    expect(csvCode("+597 889 7500")).toBe('="+597 889 7500"');
    expect(csvCode("112-3456789-01")).toBe('="112-3456789-01"');
  });

  it("writes other identifiers as (defused) text", () => {
    expect(csvCode("GR00042")).toBe("GR00042");
    expect(csvCode("1Z999AA10123456784")).toBe("1Z999AA10123456784");
    expect(csvCode("INV-2026-0001")).toBe("INV-2026-0001");
    expect(csvCode("=1+1")).toBe("'=1+1");
    expect(csvCode(null)).toBe("");
    expect(csvCode("  ")).toBe("");
  });
});

describe("escapeCsvField()", () => {
  it("quotes fields with the separator, quotes or line breaks", () => {
    expect(escapeCsvField("a;b")).toBe('"a;b"');
    expect(escapeCsvField('zei "hallo"')).toBe('"zei ""hallo"""');
    expect(escapeCsvField("regel 1\nregel 2")).toBe('"regel 1\nregel 2"');
    expect(escapeCsvField("a\r\nb")).toBe('"a\r\nb"');
    expect(escapeCsvField("1234,50")).toBe("1234,50");
    expect(escapeCsvField("")).toBe("");
  });
});

describe("buildCsv()", () => {
  type Row = {
    code: string;
    name: string;
    amount: number | null;
    date: string;
    at: string | null;
    paid: boolean;
    tracking: string | null;
  };
  const columns: CsvColumn<Row>[] = [
    { header: "GR-code", kind: "code", value: (r) => r.code },
    { header: "Naam", value: (r) => r.name },
    { header: "Bedrag", kind: "decimal", value: (r) => r.amount },
    { header: "Datum", kind: "date", value: (r) => r.date },
    { header: "Tijdstip", kind: "datetime", value: (r) => r.at },
    { header: "Betaald", kind: "boolean", value: (r) => r.paid },
    { header: "Tracking", kind: "code", value: (r) => r.tracking },
  ];
  const rows: Row[] = [
    {
      code: "GR00042",
      name: 'Pinas; "Maria"',
      amount: 1234.5,
      date: "2026-10-07",
      at: "2026-10-07T15:00:00Z",
      paid: true,
      tracking: "9400111899223397658538",
    },
    {
      code: "GR00007",
      name: "Énéas\nTweede regel",
      amount: null,
      date: "2026-01-02",
      at: null,
      paid: false,
      tracking: null,
    },
  ];

  it("starts with a UTF-8 BOM and ends every row with CRLF", () => {
    const csv = buildCsv(columns, rows);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    // The BOM is encoded as EF BB BF in the file.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes Dutch Excel rows: ';', decimal comma, dd-mm-jjjj, quoted text", () => {
    const csv = buildCsv(columns, rows).slice(CSV_BOM.length);
    expect(csv).toBe(
      [
        "GR-code;Naam;Bedrag;Datum;Tijdstip;Betaald;Tracking",
        'GR00042;"Pinas; ""Maria""";1234,50;07-10-2026;07-10-2026 12:00;ja;"=""9400111899223397658538"""',
        'GR00007;"Énéas\nTweede regel";;02-01-2026;;nee;',
        "",
      ].join("\r\n"),
    );
  });

  it("gives every row the same number of fields", () => {
    const csv = buildCsv(columns, rows).slice(CSV_BOM.length);
    // Split on CRLF outside quotes: the quoted line break is a plain \n.
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const fieldCount = (line: string) => {
      let inQuotes = false;
      let count = 1;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ";" && !inQuotes) count += 1;
      }
      return count;
    };
    expect(lines.map(fieldCount)).toEqual([7, 7, 7]);
  });

  it("writes only the header for no rows", () => {
    expect(buildCsv(columns, [])).toBe(
      `${CSV_BOM}GR-code;Naam;Bedrag;Datum;Tijdstip;Betaald;Tracking\r\n`,
    );
  });
});

describe("csvFileName()", () => {
  it("names the file after the export and the Suriname date", () => {
    expect(csvFileName("klanten", "2026-10-07")).toBe("gr-klanten-2026-10-07.csv");
    expect(csvFileName("Facturen met regels", "2026-10-07")).toBe(
      "gr-facturen-met-regels-2026-10-07.csv",
    );
  });
});

describe("downloadCsv()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downloads the text as a UTF-8 CSV blob under the given name", async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:csv";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("gr-klanten-2026-10-07.csv", `${CSV_BOM}a;b\r\n`);

    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("gr-klanten-2026-10-07.csv");
    expect(link.href).toBe("blob:csv");
    expect(created[0]?.type).toBe("text/csv;charset=utf-8");
    // jsdom's Blob has no arrayBuffer(); FileReader reads the encoded bytes.
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(created[0]!);
    });
    const bytes = new Uint8Array(buffer);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // The link is removed again.
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
