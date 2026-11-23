"""Validation helper used by tests.

Usage:
  python tools/validate.py check <file.pdf>              -> structural check with qpdf (pikepdf)
  python tools/validate.py sigs <file.pdf> [trust.crt]   -> validate all signatures with pyHanko
Prints one JSON object on stdout.
"""
import json
import sys


PASSWORD = __import__("os").environ.get("PDF_PASSWORD", "")


def check(path):
    import pikepdf
    with pikepdf.open(path, password=PASSWORD) as pdf:
        problems = pdf.check_pdf_syntax()
        return {"ok": not problems, "problems": [str(p) for p in problems], "pages": len(pdf.pages),
                "encrypted": pdf.is_encrypted, "fields": [str(f.get("/T", "")) for f in pdf.Root.get("/AcroForm", {}).get("/Fields", [])]}


def sigs(path, trust=None):
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext
    from pyhanko.keys import load_cert_from_pemder

    vc = ValidationContext(trust_roots=[load_cert_from_pemder(trust)], allow_fetching=False) if trust else None
    out = []
    with open(path, "rb") as f:
        r = PdfFileReader(f, strict=False)
        if r.encrypted:
            r.decrypt(PASSWORD)
        for emb in r.embedded_signatures:
            st = validate_pdf_signature(emb, vc)
            out.append({
                "field": emb.field_name,
                "intact": st.intact,
                "valid": st.valid,
                "trusted": st.trusted,
                "coverage": str(st.coverage),
                "modification_level": str(st.modification_level),
                "docmdp_ok": st.docmdp_ok,
                "subfilter": str(emb.sig_object.get("/SubFilter")),
                "signer": st.signing_cert.subject.human_friendly,
                "bottom_line": st.bottom_line,
            })
    return {"signatures": out}


if __name__ == "__main__":
    cmd, path = sys.argv[1], sys.argv[2]
    res = check(path) if cmd == "check" else sigs(path, sys.argv[3] if len(sys.argv) > 3 else None)
    print(json.dumps(res))
