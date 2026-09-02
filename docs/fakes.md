# Fake Register

| Fake | Skeleton behavior | Real behavior required | Status |
|---|---|---|---|
| Photo capture | Marks a placeholder as taken | Capture and validate a real photo | Fake |
| Signature | Accepts typed text | Capture a drawn signature | Fake |
| PDF generation | Displays a simulated sealing screen | Generate the finalized PDF | Fake |
| Email sending | No email is sent | Send the finalized PDF and transaction information to both parties | Fake |
| Document identity | No recipient documents exist | Prove both recipients receive identical finalized PDF bytes | Fake |
| Delivery status | Displays success without checking delivery | Distinguish provider acceptance, confirmed delivery, bounce, and failure | Fake |
| Transaction ID | Does not create one | Generate a unique transaction ID | Fake |
| Document hash | Does not calculate one | Calculate and retain a SHA-256 hash | Fake |
| Audit record | Does not store anything | Store only approved non-PII evidence | Fake |
| Data deletion | Claims nothing was stored | Prove temporary PII and files are deleted | Fake |