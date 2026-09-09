// Svix accepts strings in Workers. Its declarations also expose an optional
// Node Buffer overload, so define only the compatible byte shape instead of
// importing Node's conflicting global runtime declarations.
type Buffer = Uint8Array;
