"""Create reference PDFs signed by pyHanko (an independent implementation) for verification tests."""
from pyhanko.sign import signers, fields
from pyhanko.sign.fields import SigFieldSpec, MDPPerm
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

FX = "tests/fixtures/"
signer = signers.SimpleSigner.load_pkcs12(FX + "certs/signer.p12", passphrase=b"test")


def sign(src, dst, field, visible=True, certify=False, perm=MDPPerm.FILL_FORMS):
    with open(src, "rb") as inf:
        w = IncrementalPdfFileWriter(inf, strict=False)
        if visible:
            fields.append_signature_field(w, SigFieldSpec(field, box=(380, 40, 560, 100)))
        meta = signers.PdfSignatureMetadata(
            field_name=field, reason="Test reason", location="Warsaw",
            subfilter=fields.SigSeedSubFilter.PADES, certify=certify, docmdp_permissions=perm,
        )
        with open(dst, "wb") as outf:
            signers.sign_pdf(w, meta, signer=signer, output=outf)


sign(FX + "acroform.pdf", FX + "signed-pyhanko.pdf", "Signature1")
sign(FX + "acroform.pdf", FX + "certified-pyhanko.pdf", "Cert1", certify=True)
sign(FX + "signed-pyhanko.pdf", FX + "signed-twice-pyhanko.pdf", "Signature2", visible=False)
# Tampered copy: flip one byte inside the signed content (well away from /Contents)
data = bytearray(open(FX + "signed-pyhanko.pdf", "rb").read())
i = data.find(b"Full name")
data[i] = ord("X")
open(FX + "tampered-pyhanko.pdf", "wb").write(data)
print("signed fixtures written")
