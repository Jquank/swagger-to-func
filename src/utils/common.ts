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

const formatCode = (str: string) => {
  return format(str, {
    parser: 'typescript',
    semi: false,
    printWidth: 80,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'none',
    endOfLIne: 'Lf'
  })
}

export class Stf {
  public interfaceList: Record<string, string>
  constructor() {
    this.interfaceList = {}
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
      if (!this.interfaceList[tag]) {
        this.interfaceList[tag] = ''
      }
      this.interfaceList[tag] +=
        `interface Query_${funcName}{${queryParamType}}${eol}`
      queryParam = `params: Query_${funcName}, `
    }

    // 没有body参数，直接返回path和query参数
    if (!item.requestBody) {
      return pathParam + queryParam + axiosConfig
    }

    // 处理requestBody的情况
    const jsonContentSchmea =
      item.requestBody.content['application/json']['schema']
    const type = jsonContentSchmea.type
    const items = jsonContentSchmea.items
    const ref = jsonContentSchmea.$ref || (items ? items.$ref : null)
    let intefaceName = ''
    let interfaceStr = ''
    let str = ''
    if (ref) {
      const pathArr = ref
        .split('/')
        .filter((p: string) => p !== '#' && p !== 'components')
      let schmeaData = components[pathArr[0]][pathArr[1]]
      intefaceName = `Body_${pathArr[0]}${pathArr[1]}`
      let props = schmeaData.properties

      Object.keys(props).forEach((k) => {
        // todo ${props[k].type}如果为复杂类型，需要递归
        str += `${k}${schmeaData.required.includes(k) ? '' : '?'}: ${
          props[k].type === 'array' ? 'any[]' : props[k].type
        }${eol}`
      })
      interfaceStr += `interface ${intefaceName}{
        ${str}
      }${eol}`

      if (!this.interfaceList[tag]) {
        this.interfaceList[tag] = ''
      }
      this.interfaceList[tag] += interfaceStr
    }

    if (['string', 'number', 'boolean'].includes(type)) {
      // 简单数据类型
      return pathParam + queryParam + `data: ${item.type},` + axiosConfig
    } else if (type === 'array') {
      if (item.type) {
        // 简单数组
        return pathParam + queryParam + `data: ${item.type}[],` + axiosConfig
      } else {
        // 对象数组
        return (
          pathParam +
          queryParam +
          `data: ${intefaceName || 'any'}[],` +
          axiosConfig
        )
      }
    } else {
      // 对象类型
      return (
        pathParam + queryParam + `data: ${intefaceName || 'any'},` + axiosConfig
      )
    }
  }

  /**生成响应的data类型 */
  generateRespontDataType(
    item: any,
    components: any,
    tag: string,
    eol: string
  ) {
    if (
      !item.responses ||
      !item.responses['200'] ||
      !item.responses['200']['content']
    ) {
      return 'Promise<ResponseType<any>>'
    }
    const JsonContent = item.responses['200']['content']['application/json']
    const jsonContentSchmea = JsonContent.schema
    const type = jsonContentSchmea.type
    const items = jsonContentSchmea.items
    const ref = jsonContentSchmea.$ref || (items ? items.$ref : null)
    let intefaceName = ''
    let interfaceStr = ''
    if (ref) {
      const pathArr = ref
        .split('/')
        .filter((p: string) => p !== '#' && p !== 'components')
      let schmeaData = components[pathArr[0]][pathArr[1]]
      intefaceName = `Res_${pathArr[0]}${pathArr[1]}`
      let props = schmeaData.properties
      let str = ''
      Object.keys(props).forEach((k) => {
        // todo ${props[k].type}如果为复杂类型，需要递归
        str += `${k}${schmeaData.required.includes(k) ? '' : '?'}: ${
          props[k].type === 'array' ? 'any[]' : props[k].type
        }${eol}`
      })
      interfaceStr += `interface ${intefaceName}{
        ${str}
      }${eol}`
      if (!this.interfaceList[tag]) {
        this.interfaceList[tag] = ''
      }
      this.interfaceList[tag] += interfaceStr
    }
    if (['string', 'number', 'boolean'].includes(type)) {
      // 简单数据类型
      return `Promise<ResponseType<${type}>>`
    } else if (type === 'array') {
      if (item.type) {
        // 简单数组
        return `Promise<ResponseType<${item.type}[]>>`
      } else {
        // 对象数组
        return `Promise<ResponseType<${intefaceName || 'any'}[]>>`
      }
    } else {
      // 对象类型
      return `Promise<ResponseType<${intefaceName || 'any'}>>`
    }
  }

  /**处理swagger json数据 */
  handlePaths(swaggerJson: OpenAPIV3.Document, eol: string) {
    const paths = swaggerJson.paths
    const components = swaggerJson.components
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
          item.tags = ['common']
        }
        item.tags.forEach((tag: string) => {
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
            eol
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

  // 写入http导入文件，'@/utils/http'是个默认路径，使用者可自行修改，此文件只会写入一次
  fs.access(path.resolve(apiPath, 'http.ts')).catch(async () => {
    let str = await formatCode(`/** this file only write once, 
    * import your axios instace or other http method like axios, and then, export it 
    */${eol}
    import $http from '@/utils/http'${eol}
    export { $http }${eol}
    `)
    fs.writeFile(path.resolve(apiPath, 'http.ts'), str)
  })

  // 写入模块类和index.ts
  let indexStr = ''
  try {
    let strObj: any = new Map()
    for (const [key, v] of data) {
      let methodsStr = v.join(eol)
      let k = key.trim()
      let upperK = upperCaseFirstLetter(k)
      indexStr += `
        export { ${k}Api } from './modules/${k}.ts'`
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

  // 写入responseType.ts，使用者可自行修改，此文件只会写入一次
  let responseType = await formatCode(`
      /* eslint-disable @typescript-eslint/no-explicit-any */
      /** this file only write once, 
       * you can modify this type according to your needs, the generic type T is the response data type, 
       */
      export { AxiosRequestConfig } from 'axios'
      export interface ResponseType<T = any> {
        code?: number
        status?: number
        message?: string
        success?: boolean
        data?: T
      }`)
  fs.access(path.resolve(apiPath, `responseType.ts`)).catch(() => {
    fs.writeFile(path.resolve(apiPath, 'responseType.ts'), responseType)
  })
}
