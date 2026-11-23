"""Encrypted test PDFs, made with qpdf (via pikepdf) as an independent implementation.

Covers RC4-128 (R3), AES-128 (R4) and AES-256 (R6); "permissions only" files (empty open
password, editing restricted) and one that needs an open password; xref tables and object streams.
"""
import pikepdf
from pikepdf import Encryption, Permissions

FX = "tests/fixtures/"
RESTRICTED = Permissions(modify_other=False, modify_annotation=False, modify_form=False, modify_assembly=False, extract=False)

def make(src, dst, **enc):
    with pikepdf.open(FX + src) as pdf:
        osm = enc.pop("osm", pikepdf.ObjectStreamMode.preserve)
        pdf.save(FX + dst, encryption=Encryption(**enc), object_stream_mode=osm)

make("acroform.pdf", "enc-rc4.pdf", owner="owner", user="", R=3, aes=False, allow=RESTRICTED, metadata=False)
make("acroform.pdf", "enc-aes128.pdf", owner="owner", user="", R=4, aes=True, allow=RESTRICTED)
make("acroform.pdf", "enc-aes256.pdf", owner="owner", user="", R=6, allow=RESTRICTED,
     osm=pikepdf.ObjectStreamMode.generate)
make("flat-form.pdf", "enc-aes256-password.pdf", owner="owner", user="secret", R=6)
make("polish.pdf", "enc-aes128-nometa.pdf", owner="owner", user="", R=4, aes=True, metadata=False)
print("encrypted fixtures written")
