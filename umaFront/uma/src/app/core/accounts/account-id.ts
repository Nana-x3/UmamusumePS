export type ViewerId = string


export function newViewerId(): ViewerId{
  const chars = '0123456789'
  let out: string = ''

  for (let i = 0; i < 12; i++){
    let char: string
    if (i === 0){
      const beginChars = '123456789'
      char = beginChars[Math.floor(Math.random() * beginChars.length)]
    }else {
      char = chars[Math.floor(Math.random() * chars.length)]
    }
    out += char

  }
  return out
}

 export function isValidViewerId(id: ViewerId): boolean{
  if (id.length !== 12 ){return false}
  else {
    const chars = "0123456789"
    for (const digit of id) {
      if (!chars.includes(digit)) return false
    }
  }
  return true
}
