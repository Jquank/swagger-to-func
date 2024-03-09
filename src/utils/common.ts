import { OpenAPIV3 } from 'openapi-types'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { format } from 'prettier'

const getPath = (dirname: string) => {
  return path.resolve(dirname, 'src/_api')
}

const upperCaseFirstLetter = (letter: string) => {
  let k = letter.trim()
  return k.replace(k[0], k[0].toUpperCase())
}

let defaultPrettierConfig = JSON.stringify({
  parser: 'typescript',
  semi: false,
  printWidth: 80,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'none',
  endOfLIne: 'Lf'
})

const formatCode = (str: string) => {
  return format(str, JSON.parse(defaultPrettierConfig))
}

export class Stf {
  private static funcName = '_funcName_' // 默认函数名
  public interfaceList: Record<string, string>
  public dtoTypes: string
  public tag: string
  constructor() {
    this.interfaceList = {}
    this.dtoTypes = ''
    this.tag = ''
  }
  /**生成函数名 */
  generateFuncName(
    key: string,
    item: OpenAPIV3.OperationObject,
    method: string,
    tag: string
  ) {
    let str = method
    let pathArr = key.split('/').filter((p) => p && p !== 'api')
    pathArr.forEach((p) => {
      if (p.includes('{')) {
        str += `By${upperCaseFirstLetter(p.match(/\{(.*)\}/)![1])}`
      } else {
        str += upperCaseFirstLetter(p)
      }
    })
    return str
  }

  /** 生成类型 */
  getType(schema: any, eol: string, prefix?: string) {
    if (schema.type) {
      if (schema.type === 'array') {
        // 数组类型（有items，分为items.type和item.$ref）
        if (schema.items.type) {
          return `${schema.items.type}[]`
        } else if (schema.items.$ref) {
          let interfaceName = this.getRefType(schema.items.$ref)
          return `${interfaceName}[]`
        } else {
          return `any[]`
        }
      } else if (schema.type === 'object') {
        // 对象类型，Stf.funcName为虚拟代位函数名，后续做统一替换处理
        try {
          const props = schema.properties || {}
          /** upKey为上层对象的属性名  */
          const upKey = schema._upKey_
          const name = schema._typeName_
          const required = schema.required || []
          let interfaceName = ''
          let str = ''
          const isContainPrefix = (s: string) =>
            new RegExp('^' + prefix).test(s)
          if (prefix === 'Dto') {
            let rPrefix = isContainPrefix(name) ? '' : prefix + '_'
            interfaceName = rPrefix + name + (upKey ? `_${upKey}` : '')
            str = `interface ${interfaceName} {${eol}`
          } else {
            let rPrefix = !name || !isContainPrefix(name) ? prefix + '_' : ''
            interfaceName =
              rPrefix + (name || Stf.funcName) + (upKey ? `_${upKey}` : '')
            str = `${upKey ? '' : 'export'} interface ${interfaceName} {${eol}`
          }
          Object.keys(props).forEach((k) => {
            str += `${k}${required.includes(k) ? '' : '?'}: ${this.getType({ _upKey_: k, _typeName_: interfaceName, ...props[k] }, eol, prefix)}${eol}`
          })
          str += `}${eol}`
          if (prefix === 'Dto') {
            this.dtoTypes += str
          } else {
            this.interfaceList[this.tag] += str
          }

          return interfaceName
        } catch {
          return 'any'
        }
      } else {
        // 基本类型
        return `${schema.type}`
      }
    } else if (schema.$ref) {
      let interfaceName = this.getRefType(schema.$ref)

      return interfaceName
    } else {
      return 'any'
    }
  }

  /**生成所有dto类型，放入this.dtoTypes */
  getDtoType(components: any, eol: string) {
    let schemas: Record<string, any> = components.schemas
    for (const [name, v] of Object.entries(schemas)) {
      this.getType({ _typeName_: name, ...v }, eol, 'Dto')
    }
  }

  /** 处理$ref类型*/
  getRefType(ref: string, components?: any, eol?: string, dtoName?: string) {
    const pathArr = ref
      .split('/')
      .filter((p: string) => p !== '#' && p !== 'components')
    const name = pathArr[1]
    return 'Dto_' + name
  }

  /**生成参数及参数类型 */
  generateArguments(
    funcName: string,
    item: any,
    components: any,
    tag: string,
    eol: string
  ) {
    const parameters = item.parameters
    let pathParam = ''
    let queryParam = ''
    let queryParamType = ''
    let axiosConfig = 'axiosConfig: AxiosRequestConfig = {}'
    if (parameters && parameters.length) {
      parameters.forEach((p: any) => {
        // 参数是path类型
        if (p.in === 'path') {
          pathParam += `${p.name}: ${p.schema.type || 'string'}, `
        }
        // 参数是query类型
        if (p.in === 'query') {
          queryParamType += `${p.name}: ${p.schema.type || 'any'}, `
        }
      })
    }
    // 处理query参数及类型
    if (queryParamType) {
      this.interfaceList[tag] +=
        `interface Query_${funcName}{${queryParamType}}${eol}`
      queryParam = `params: Query_${funcName}, `
    }

    // 没有body参数，直接返回path和query参数
    if (
      !item.requestBody ||
      !item.requestBody.content ||
      !item.requestBody.content['application/json'] ||
      !item.requestBody.content['application/json']['schema']
    ) {
      return pathParam + queryParam + axiosConfig
    }

    // 处理requestBody的情况
    const jsonContentSchmea =
      item.requestBody.content['application/json']['schema']

    const bodyDataType = this.getType(jsonContentSchmea, eol, 'Body')
    let rdt = ''
    // 参数类型如果不是基本数据类型和any，则统一取名Body_+函数名，并导出
    if (
      !['string', 'number', 'boolean', 'symbol', 'bigint', 'any'].includes(
        bodyDataType.replace('[]', '')
      )
    ) {
      rdt = bodyDataType.includes('[]')
        ? `Body_${funcName}[]`
        : `Body_${funcName}`
      if (!bodyDataType.includes(Stf.funcName)) {
        this.interfaceList[tag] +=
          `export type Body_${funcName} = ${bodyDataType.replace('[]', '')}${eol}`
      }
    } else {
      rdt = bodyDataType
    }
    return pathParam + queryParam + `data: ${rdt},` + axiosConfig
  }

  /**生成响应的data类型 */
  generateRespontDataType(
    item: any,
    components: any,
    tag: string,
    eol: string,
    funcName: string
  ) {
    if (
      !item.responses ||
      !item.responses['200'] ||
      !item.responses['200']['content'] ||
      !item.responses['200']['content']['application/json']
    ) {
      return 'Promise<ResponseType<any>>'
    }
    const JsonContent = item.responses['200']['content']['application/json']
    const jsonContentSchmea = JsonContent.schema

    const responseDataType = this.getType(jsonContentSchmea, eol, 'Res')
    let rdt = ''
    // 响应类型如果不是基本数据类型和any，则统一取名Res_+函数名，并导出
    if (
      !['string', 'number', 'boolean', 'symbol', 'bigint', 'any'].includes(
        responseDataType.replace('[]', '')
      )
    ) {
      rdt = responseDataType.includes('[]')
        ? `Res_${funcName}[]`
        : `Res_${funcName}`
      if (!responseDataType.includes(Stf.funcName)) {
        this.interfaceList[tag] +=
          `export type Res_${funcName} = ${responseDataType.replace('[]', '')}${eol}`
      }
    } else {
      rdt = responseDataType
    }
    return `Promise<ResponseType<${rdt}>>`
  }

  /**处理swagger json数据 */
  handlePaths(swaggerJson: OpenAPIV3.Document, eol: string) {
    const paths = swaggerJson.paths
    const components = swaggerJson.components
    // 生成dto类型
    this.getDtoType(components, eol)

    const funcMap = new Map()
    Object.keys(paths).forEach((key) => {
      let d = paths[key]

      let correctRequestPath = (
        key.includes('{')
          ? '`' + key.replace(/{/g, '${') + '`'
          : "'" + key + "'"
      ).toString()

      for (const method in d) {
        let me = method as OpenAPIV3.HttpMethods
        const item = d[me]! as OpenAPIV3.OperationObject
        if (!item.tags) {
          // 如果没有tag分类，则创建_common模块
          item.tags = ['_common']
        }
        item.tags.forEach((tag: string) => {
          this.tag = tag
          if (!this.interfaceList[tag]) {
            this.interfaceList[tag] = ''
          }

          const funcName = this.generateFuncName(key, item, me, tag)
          const requestBody = item.requestBody as OpenAPIV3.RequestBodyObject
          let required = requestBody && requestBody.required
          if (!funcMap.get(tag)) {
            funcMap.set(tag, [])
          }
          let mapValue = funcMap.get(tag)
          // 构造参数
          let funcArguments = this.generateArguments(
            funcName,
            item,
            components,
            tag,
            eol
          )
          // 构造传参
          let args = ''
          ;['params', 'data'].forEach((argType) => {
            if (
              funcArguments.includes(argType + ':') ||
              funcArguments.includes(argType + '?:')
            ) {
              args += `${argType},`
            }
          })
          args += '...axiosConfig,'
          // response类型
          let respontDataType = this.generateRespontDataType(
            item,
            components,
            tag,
            eol,
            funcName
          )

          this.interfaceList[tag] = this.interfaceList[tag].replace(
            new RegExp(Stf.funcName, 'g'),
            funcName
          )

          mapValue.push(
            `
            /** ${item.summary || ''} */
            ${funcName}(${funcArguments}): ${respontDataType}{${eol}
            return $http.request({url:${correctRequestPath}, method: '${me}', ${args ? `...{${args}}` : ''}})}`
          )
        })
      }
    })
    return funcMap
  }
}

export const main = async (dirname: string, url: string) => {
  const stf = new Stf()
  const apiPath = getPath(dirname)
  // 获取swagger-json
  let swaggerJson: OpenAPIV3.Document
  let res = await fetch(url).then((res) => res.json())
  swaggerJson = res as OpenAPIV3.Document
  // 获取不同操作系统的换行符
  const eol = os.type().includes('Windows') ? '\r\n' : '\r'
  // 处理swagger json
  let data = stf.handlePaths(swaggerJson, eol)

  // 创建文件夹 /src/_api/modules
  await fs.mkdir(path.resolve(apiPath, 'modules'), {
    recursive: true
  })

  // 写入格式化配置文件，一次
  try {
    await fs.access(
      path.resolve(apiPath, 'prettierConfig.json'),
      fs.constants.F_OK
    )
    defaultPrettierConfig = await fs.readFile(
      path.resolve(apiPath, 'prettierConfig.json'),
      'utf-8'
    )
  } catch (error) {
    let str = await format(defaultPrettierConfig, { parser: 'json' })
    fs.writeFile(path.resolve(apiPath, 'prettierConfig.json'), str)
  }

  // // 写入dto类型文件
  // let dtoStr = await formatCode(stf.dtoTypes)
  // fs.writeFile(path.resolve(apiPath, 'dtoType.ts'), dtoStr)

  // 写入http导入文件，'@/utils/http'是个默认路径，使用者可自行修改
  let defaultHttpStr = `
    /** import your axios instace or other http method like axios, and then, export it */${eol}
    import $http from '@/utils/http'${eol}
    export { $http }${eol}
    `
  fs.access(path.resolve(apiPath, 'http.ts'), fs.constants.F_OK)
    .then(async () => {
      let res = await fs.readFile(path.resolve(apiPath, 'http.ts'), 'utf-8')
      let str = await formatCode(res)
      fs.writeFile(path.resolve(apiPath, 'http.ts'), str)
    })
    .catch(async () => {
      let str = await formatCode(defaultHttpStr)
      fs.writeFile(path.resolve(apiPath, 'http.ts'), str)
    })

  let regName = /Dto_\w+/g
  /** 从dtoTypes中截取所要用到的类型（包含dto相互引用和循环引用） */
  const sliceDtoTypes = (tag: string, nameMatch: string[] | null) => {
    if (!nameMatch) {
      return
    }
    nameMatch.forEach((name) => {
      let str = `interface ${name}`
      let regInterface = new RegExp(`${str} {[^}]*}`)
      let match = stf.dtoTypes.match(regInterface)
      if (match) {
        // 防止重复写入
        if (stf.interfaceList[tag].includes(str)) {
          return
        }
        stf.interfaceList[tag] = match[0] + `${eol}` + stf.interfaceList[tag]
        sliceDtoTypes(tag, match[0].match(regName))
      }
    })
  }
  // 写入模块类和index.ts
  let indexStr = ''
  try {
    let strObj: any = new Map()
    for (const [key, v] of data) {
      let methodsStr = v.join(eol)
      let k = key.trim()
      let upperK = upperCaseFirstLetter(k)
      indexStr += `
        import type * as ${upperCaseFirstLetter(k)}Type from './modules/${k}.ts'
        import { ${k}Api } from './modules/${k}.ts'
        export type { ${upperCaseFirstLetter(k)}Type }
        export { ${k}Api }
        ${eol}`

      sliceDtoTypes(k, stf.interfaceList[k].match(regName))

      console.log(stf.dtoTypes)

      let str = await formatCode(`
        /* eslint-disable @typescript-eslint/no-explicit-any */
        import { $http } from '../http'${eol}
        import { ResponseType, AxiosRequestConfig } from '../responseType'${eol}
        ${stf.interfaceList[k]}${eol}
        class ${upperK}{${eol}
        ${methodsStr}
        }${eol}
        export const ${k}Api = new ${upperK}()${eol}`)
      strObj.set(k, str)
    }

    for (const [k, str] of strObj) {
      fs.writeFile(path.resolve(apiPath, `modules/${k}.ts`), str)
    }
    let formatIndexStr = await formatCode(indexStr)
    fs.writeFile(path.resolve(apiPath, `index.ts`), formatIndexStr)
  } catch (error) {
    throw error
  }

  // 写入responseType.ts，使用者可自行修改
  let responseType = await formatCode(`
      /* eslint-disable @typescript-eslint/no-explicit-any */
      /** you can modify this type according to your needs, the generic type T is the response data type */
      export type { AxiosRequestConfig } from 'axios'
      export interface ResponseType<T = any> {
        code: number
        message: string
        data: T
        status?: number
        success?: boolean
        path?: string
        time?: number | string
      }`)
  fs.access(path.resolve(apiPath, 'responseType.ts'), fs.constants.F_OK)
    .then(async () => {
      let res = await fs.readFile(
        path.resolve(apiPath, 'responseType.ts'),
        'utf-8'
      )
      let str = await formatCode(res)
      fs.writeFile(path.resolve(apiPath, 'responseType.ts'), str)
    })
    .catch(async () => {
      let str = await formatCode(responseType)
      fs.writeFile(path.resolve(apiPath, 'responseType.ts'), str)
    })
}
