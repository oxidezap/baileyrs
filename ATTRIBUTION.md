# Attribution

## Baileys (API inspiration)

baileyrs was originally forked from [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys),
a popular WebSockets library for WhatsApp Web written in TypeScript.

The internals of baileyrs have been rewritten from scratch on top of
[whatsapp-rust](https://github.com/oxidezap/whatsapp-rust) compiled to WebAssembly.
baileyrs does **not** redistribute Baileys source code — the public API shape is
preserved intentionally so that projects built against Baileys can migrate with
minimal friction, but the implementation is a fresh reimplementation.

Baileys is distributed under the MIT License. Its copyright notice is reproduced
below as acknowledgment:

> MIT License
>
> Copyright (c) 2025 Rajeh Taher/WhiskeySockets
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

## whatsapp-rust (runtime engine)

The actual WhatsApp protocol implementation used by baileyrs lives in
[whatsapp-rust](https://github.com/oxidezap/whatsapp-rust), a Rust library
distributed via the [whatsapp-rust-bridge](https://www.npmjs.com/package/whatsapp-rust-bridge)
npm package (Rust code compiled to WebAssembly).

whatsapp-rust is itself inspired by prior art in the WhatsApp reverse-engineering
community, notably [whatsmeow](https://github.com/tulir/whatsmeow) (Go) and
[Baileys](https://github.com/WhiskeySockets/Baileys) (TypeScript).
