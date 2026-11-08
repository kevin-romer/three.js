import { BackSide, DoubleSide, ObjectSpaceNormalMap, TangentSpaceNormalMap, NoToneMapping, NormalBlending, SRGBTransfer, RGFormat, RG11_EAC_Format, RED_GREEN_RGTC2_Format } from '../../constants.js';
import { Layers } from '../../core/Layers.js';
import { WebGLProgram } from './WebGLProgram.js';
import { WebGLShaderCache } from './WebGLShaderCache.js';
import { ShaderLib } from '../shaders/ShaderLib.js';
import { UniformsUtils } from '../shaders/UniformsUtils.js';
import { ColorManagement } from '../../math/ColorManagement.js';
import { warn } from '../../utils.js';

function isPackedRGFormat( format ) {

	return format === RGFormat || format === RG11_EAC_Format || format === RED_GREEN_RGTC2_Format;

}

function WebGLPrograms( renderer, environments, extensions, capabilities, bindingStates, clipping, maxInactivePrograms = 0 ) {

	const _programLayers = new Layers();
	const _customShaders = new WebGLShaderCache();
	const _activeChannels = new Set();
	const programs = [];
	const programsMap = new Map();
	const inactivePrograms = new Map();
	const programShaderReferences = new Set();
	const parameterPool = [];
	const pooledParameters = new WeakSet();

	const logarithmicDepthBuffer = capabilities.logarithmicDepthBuffer;

	const shaderIDs = {
		MeshDepthMaterial: 'depth',
		MeshDistanceMaterial: 'distance',
		MeshNormalMaterial: 'normal',
		MeshBasicMaterial: 'basic',
		MeshLambertMaterial: 'lambert',
		MeshPhongMaterial: 'phong',
		MeshToonMaterial: 'toon',
		MeshStandardMaterial: 'physical',
		MeshPhysicalMaterial: 'physical',
		MeshMatcapMaterial: 'matcap',
		LineBasicMaterial: 'basic',
		LineDashedMaterial: 'dashed',
		PointsMaterial: 'points',
		ShadowMaterial: 'shadow',
		SpriteMaterial: 'sprite'
	};

	function getChannel( value ) {

		_activeChannels.add( value );

		if ( value === 0 ) return 'uv';

		return `uv${ value }`;

	}

	function getParameters( material, lights, shadows, scene, object, lightProbeGrids ) {

		return new WebGLProgramParameters( material, lights, shadows, scene, object, lightProbeGrids );

	}

	function acquireParameters( material, lights, shadows, scene, object, lightProbeGrids ) {

		const parameters = parameterPool.pop();

		try {

			if ( parameters !== undefined ) return WebGLProgramParameters.call( parameters, material, lights, shadows, scene, object, lightProbeGrids );

			const created = getParameters( material, lights, shadows, scene, object, lightProbeGrids );
			pooledParameters.add( created );
			return created;

		} catch ( error ) {

			if ( parameters !== undefined ) releaseParameters( parameters );
			_activeChannels.clear();
			throw error;

		}

	}

	function releaseParameters( parameters ) {

		parameters.defines = undefined;
		parameters.uniforms = undefined;
		parameters.vertexShader = undefined;
		parameters.fragmentShader = undefined;
		parameters.customVertexShaderStage = undefined;
		parameters.customFragmentShaderStage = undefined;
		parameters.shaderName = undefined;
		parameters.shaderType = undefined;
		parameters.customProgramCacheKey = undefined;

		if ( parameterPool.length < 4 ) parameterPool.push( parameters );

	}

	function copyParameters( parameters ) {

		// Keep hook-visible records independent, with the same optional fields and order.
		const { uniforms, customVertexShaderStage, customFragmentShaderStage, ...copy } = parameters;
		if ( customVertexShaderStage !== undefined ) copy.customVertexShaderStage = customVertexShaderStage;
		if ( customFragmentShaderStage !== undefined ) copy.customFragmentShaderStage = customFragmentShaderStage;
		copy.uniforms = uniforms;
		return copy;

	}

	// Constructor assignments keep this large record in fast property storage.
	// Preserve the plain-object prototype expected by onBeforeCompile callbacks.
	WebGLProgramParameters.prototype = Object.prototype;

	function WebGLProgramParameters( material, lights, shadows, scene, object, lightProbeGrids ) {

		const fog = scene.fog;
		const geometry = object.geometry;
		const environment = ( material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial ) ? scene.environment : null;

		const usePMREM = material.isMeshStandardMaterial || ( material.isMeshLambertMaterial && ! material.envMap ) || ( material.isMeshPhongMaterial && ! material.envMap );
		const envMap = environments.get( material.envMap || environment, usePMREM );

		const shaderID = shaderIDs[ material.type ];

		// heuristics to create shader parameters according to lights in the scene
		// (not to blow over maxLights budget)

		let precision = capabilities.precision;

		if ( material.precision !== null ) {

			precision = capabilities.getMaxPrecision( material.precision );

			if ( precision !== material.precision ) {

				warn( 'WebGLProgram.getParameters:', material.precision, 'not supported, using', precision, 'instead.' );

			}

		}

		//

		const morphAttribute = geometry.morphAttributes.position || geometry.morphAttributes.normal || geometry.morphAttributes.color;
		const morphTargetsCount = ( morphAttribute !== undefined ) ? morphAttribute.length : 0;

		let morphTextureStride = 0;

		if ( geometry.morphAttributes.position !== undefined ) morphTextureStride = 1;
		if ( geometry.morphAttributes.normal !== undefined ) morphTextureStride = 2;
		if ( geometry.morphAttributes.color !== undefined ) morphTextureStride = 3;

		//

		let vertexShader, fragmentShader;
		let customVertexShaderID, customFragmentShaderID;
		let customVertexShaderStage, customFragmentShaderStage;

		if ( shaderID ) {

			const shader = ShaderLib[ shaderID ];

			vertexShader = shader.vertexShader;
			fragmentShader = shader.fragmentShader;

		} else {

			vertexShader = material.vertexShader;
			fragmentShader = material.fragmentShader;

			const vertexShaderStage = _customShaders.getVertexShaderStage( material );
			const fragmentShaderStage = _customShaders.getFragmentShaderStage( material );

			_customShaders.update( material, vertexShaderStage, fragmentShaderStage );

			customVertexShaderID = vertexShaderStage.id;
			customFragmentShaderID = fragmentShaderStage.id;

			if ( maxInactivePrograms > 0 ) {

				customVertexShaderStage = vertexShaderStage;
				customFragmentShaderStage = fragmentShaderStage;

			}

		}

		const currentRenderTarget = renderer.getRenderTarget();
		const reversedDepthBuffer = renderer.state.buffers.depth.getReversed();

		const IS_INSTANCEDMESH = object.isInstancedMesh === true;
		const IS_BATCHEDMESH = object.isBatchedMesh === true;

		const HAS_MAP = !! material.map;
		const HAS_MATCAP = !! material.matcap;
		const HAS_ENVMAP = !! envMap;
		const HAS_PMREM = HAS_ENVMAP && envMap.isPMREMTexture === true;
		const HAS_AOMAP = !! material.aoMap;
		const HAS_LIGHTMAP = !! material.lightMap;
		const HAS_BUMPMAP = !! material.bumpMap && material.wireframe === false;
		const HAS_NORMALMAP = !! material.normalMap;
		const HAS_DISPLACEMENTMAP = !! material.displacementMap;
		const HAS_EMISSIVEMAP = !! material.emissiveMap;

		const HAS_METALNESSMAP = !! material.metalnessMap;
		const HAS_ROUGHNESSMAP = !! material.roughnessMap;

		const HAS_ANISOTROPY = material.anisotropy > 0;
		const HAS_CLEARCOAT = material.clearcoat > 0;
		const HAS_DIFFUSE_ROUGHNESS = material.diffuseRoughness > 0;
		const HAS_DISPERSION = material.dispersion > 0;
		const HAS_RETROREFLECTION = material.retroreflectivity > 0;
		const HAS_IRIDESCENCE = material.iridescence > 0;
		const HAS_SHEEN = material.sheen > 0;
		const HAS_TRANSMISSION = material.transmission > 0;

		const HAS_ANISOTROPYMAP = HAS_ANISOTROPY && !! material.anisotropyMap;

		const HAS_CLEARCOATMAP = HAS_CLEARCOAT && !! material.clearcoatMap;
		const HAS_CLEARCOAT_NORMALMAP = HAS_CLEARCOAT && !! material.clearcoatNormalMap;
		const HAS_CLEARCOAT_ROUGHNESSMAP = HAS_CLEARCOAT && !! material.clearcoatRoughnessMap;
		const HAS_DIFFUSE_ROUGHNESSMAP = HAS_DIFFUSE_ROUGHNESS && !! material.diffuseRoughnessMap;

		const HAS_IRIDESCENCEMAP = HAS_IRIDESCENCE && !! material.iridescenceMap;
		const HAS_IRIDESCENCE_THICKNESSMAP = HAS_IRIDESCENCE && !! material.iridescenceThicknessMap;

		const HAS_SHEEN_COLORMAP = HAS_SHEEN && !! material.sheenColorMap;
		const HAS_SHEEN_ROUGHNESSMAP = HAS_SHEEN && !! material.sheenRoughnessMap;

		const HAS_SPECULARMAP = !! material.specularMap;
		const HAS_SPECULAR_COLORMAP = !! material.specularColorMap;
		const HAS_SPECULAR_INTENSITYMAP = !! material.specularIntensityMap;

		const HAS_TRANSMISSIONMAP = HAS_TRANSMISSION && !! material.transmissionMap;
		const HAS_THICKNESSMAP = HAS_TRANSMISSION && !! material.thicknessMap;

		const HAS_GRADIENTMAP = !! material.gradientMap;

		const HAS_ALPHAMAP = !! material.alphaMap;

		const HAS_ALPHATEST = material.alphaTest > 0;

		const HAS_ALPHAHASH = !! material.alphaHash;

		const HAS_EXTENSIONS = !! material.extensions;

		let toneMapping = NoToneMapping;

		if ( material.toneMapped ) {

			if ( currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true ) {

				toneMapping = renderer.toneMapping;

			}

		}

		const envMapMipmaps = HAS_PMREM ? ( envMap.isCompressedCubeTexture ? envMap.image[ 0 ].mipmaps : envMap.mipmaps ) : null;

		const parameters = this;

		parameters.shaderID = shaderID;
		parameters.shaderType = material.type;
		parameters.shaderName = material.name;
		parameters.vertexShader = vertexShader;
		parameters.fragmentShader = fragmentShader;
		parameters.defines = material.defines;
		parameters.customVertexShaderID = customVertexShaderID;
		parameters.customFragmentShaderID = customFragmentShaderID;
		parameters.isRawShaderMaterial = material.isRawShaderMaterial === true;
		parameters.glslVersion = material.glslVersion;
		parameters.precision = precision;
		parameters.batching = IS_BATCHEDMESH;
		parameters.batchingColor = IS_BATCHEDMESH && object._colorsTexture !== null;
		parameters.instancing = IS_INSTANCEDMESH;
		parameters.instancingColor = IS_INSTANCEDMESH && object.instanceColor !== null;
		parameters.instancingMorph = IS_INSTANCEDMESH && object.morphTexture !== null;
		parameters.outputColorSpace = ( currentRenderTarget === null ) ? renderer.outputColorSpace : ( currentRenderTarget.isXRRenderTarget === true ? currentRenderTarget.texture.colorSpace : ColorManagement.workingColorSpace );
		parameters.alphaToCoverage = !! material.alphaToCoverage;
		parameters.map = HAS_MAP;
		parameters.matcap = HAS_MATCAP;
		parameters.envMap = HAS_ENVMAP;
		parameters.envMapMode = HAS_ENVMAP && envMap.mapping;
		parameters.envMapPMREM = HAS_PMREM;
		parameters.envMapMaxLod = HAS_PMREM ? envMapMipmaps.length - 1 : null;
		parameters.envMapSize = HAS_PMREM ? envMapMipmaps[ 0 ].width : null;
		parameters.aoMap = HAS_AOMAP;
		parameters.lightMap = HAS_LIGHTMAP;
		parameters.bumpMap = HAS_BUMPMAP;
		parameters.normalMap = HAS_NORMALMAP;
		parameters.displacementMap = HAS_DISPLACEMENTMAP;
		parameters.emissiveMap = HAS_EMISSIVEMAP;
		parameters.normalMapObjectSpace = HAS_NORMALMAP && material.normalMapType === ObjectSpaceNormalMap;
		parameters.normalMapTangentSpace = HAS_NORMALMAP && material.normalMapType === TangentSpaceNormalMap;
		parameters.packedNormalMap = HAS_NORMALMAP && material.normalMapType === TangentSpaceNormalMap && isPackedRGFormat( material.normalMap.format	);
		parameters.metalnessMap = HAS_METALNESSMAP;
		parameters.roughnessMap = HAS_ROUGHNESSMAP;
		parameters.anisotropy = HAS_ANISOTROPY;
		parameters.anisotropyMap = HAS_ANISOTROPYMAP;
		parameters.clearcoat = HAS_CLEARCOAT;
		parameters.clearcoatMap = HAS_CLEARCOATMAP;
		parameters.clearcoatNormalMap = HAS_CLEARCOAT_NORMALMAP;
		parameters.clearcoatRoughnessMap = HAS_CLEARCOAT_ROUGHNESSMAP;
		parameters.diffuseRoughness = HAS_DIFFUSE_ROUGHNESS;
		parameters.diffuseRoughnessMap = HAS_DIFFUSE_ROUGHNESSMAP;
		parameters.dispersion = HAS_DISPERSION;
		parameters.retroreflection = HAS_RETROREFLECTION;
		parameters.iridescence = HAS_IRIDESCENCE;
		parameters.iridescenceMap = HAS_IRIDESCENCEMAP;
		parameters.iridescenceThicknessMap = HAS_IRIDESCENCE_THICKNESSMAP;
		parameters.sheen = HAS_SHEEN;
		parameters.sheenColorMap = HAS_SHEEN_COLORMAP;
		parameters.sheenRoughnessMap = HAS_SHEEN_ROUGHNESSMAP;
		parameters.specularMap = HAS_SPECULARMAP;
		parameters.specularColorMap = HAS_SPECULAR_COLORMAP;
		parameters.specularIntensityMap = HAS_SPECULAR_INTENSITYMAP;
		parameters.transmission = HAS_TRANSMISSION;
		parameters.transmissionMap = HAS_TRANSMISSIONMAP;
		parameters.thicknessMap = HAS_THICKNESSMAP;
		parameters.gradientMap = HAS_GRADIENTMAP;
		parameters.opaque = material.transparent === false && material.blending === NormalBlending && material.alphaToCoverage === false;
		parameters.alphaMap = HAS_ALPHAMAP;
		parameters.alphaTest = HAS_ALPHATEST;
		parameters.alphaHash = HAS_ALPHAHASH;
		parameters.combine = material.combine;
		parameters.mapUv = HAS_MAP && getChannel( material.map.channel );
		parameters.aoMapUv = HAS_AOMAP && getChannel( material.aoMap.channel );
		parameters.lightMapUv = HAS_LIGHTMAP && getChannel( material.lightMap.channel );
		parameters.bumpMapUv = HAS_BUMPMAP && getChannel( material.bumpMap.channel );
		parameters.normalMapUv = HAS_NORMALMAP && getChannel( material.normalMap.channel );
		parameters.displacementMapUv = HAS_DISPLACEMENTMAP && getChannel( material.displacementMap.channel );
		parameters.emissiveMapUv = HAS_EMISSIVEMAP && getChannel( material.emissiveMap.channel );
		parameters.metalnessMapUv = HAS_METALNESSMAP && getChannel( material.metalnessMap.channel );
		parameters.roughnessMapUv = HAS_ROUGHNESSMAP && getChannel( material.roughnessMap.channel );
		parameters.anisotropyMapUv = HAS_ANISOTROPYMAP && getChannel( material.anisotropyMap.channel );
		parameters.clearcoatMapUv = HAS_CLEARCOATMAP && getChannel( material.clearcoatMap.channel );
		parameters.clearcoatNormalMapUv = HAS_CLEARCOAT_NORMALMAP && getChannel( material.clearcoatNormalMap.channel );
		parameters.clearcoatRoughnessMapUv = HAS_CLEARCOAT_ROUGHNESSMAP && getChannel( material.clearcoatRoughnessMap.channel );
		parameters.diffuseRoughnessMapUv = HAS_DIFFUSE_ROUGHNESSMAP && getChannel( material.diffuseRoughnessMap.channel );
		parameters.iridescenceMapUv = HAS_IRIDESCENCEMAP && getChannel( material.iridescenceMap.channel );
		parameters.iridescenceThicknessMapUv = HAS_IRIDESCENCE_THICKNESSMAP && getChannel( material.iridescenceThicknessMap.channel );
		parameters.sheenColorMapUv = HAS_SHEEN_COLORMAP && getChannel( material.sheenColorMap.channel );
		parameters.sheenRoughnessMapUv = HAS_SHEEN_ROUGHNESSMAP && getChannel( material.sheenRoughnessMap.channel );
		parameters.specularMapUv = HAS_SPECULARMAP && getChannel( material.specularMap.channel );
		parameters.specularColorMapUv = HAS_SPECULAR_COLORMAP && getChannel( material.specularColorMap.channel );
		parameters.specularIntensityMapUv = HAS_SPECULAR_INTENSITYMAP && getChannel( material.specularIntensityMap.channel );
		parameters.transmissionMapUv = HAS_TRANSMISSIONMAP && getChannel( material.transmissionMap.channel );
		parameters.thicknessMapUv = HAS_THICKNESSMAP && getChannel( material.thicknessMap.channel );
		parameters.alphaMapUv = HAS_ALPHAMAP && getChannel( material.alphaMap.channel );
		parameters.vertexTangents = !! geometry.attributes.tangent && ( HAS_NORMALMAP || HAS_ANISOTROPY );
		parameters.vertexNormals = !! geometry.attributes.normal;
		parameters.vertexColors = material.vertexColors;
		parameters.vertexAlphas = material.vertexColors === true && !! geometry.attributes.color && geometry.attributes.color.itemSize === 4;
		parameters.pointsUvs = object.isPoints === true && !! geometry.attributes.uv && ( HAS_MAP || HAS_ALPHAMAP );
		parameters.fog = !! fog;
		parameters.useFog = material.fog === true;
		parameters.fogExp2 = !! fog && fog.isFogExp2;
		parameters.flatShading = material.wireframe === false && (
			material.flatShading === true ||
				( geometry.attributes.normal === undefined && HAS_NORMALMAP === false &&
					( material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshStandardMaterial || material.isMeshPhysicalMaterial )
				)
		);
		parameters.sizeAttenuation = material.sizeAttenuation === true;
		parameters.logarithmicDepthBuffer = logarithmicDepthBuffer;
		parameters.reversedDepthBuffer = reversedDepthBuffer;
		parameters.skinning = object.isSkinnedMesh === true;
		parameters.hasPositionAttribute = geometry.attributes.position !== undefined;
		parameters.morphTargets = geometry.morphAttributes.position !== undefined;
		parameters.morphNormals = geometry.morphAttributes.normal !== undefined;
		parameters.morphColors = geometry.morphAttributes.color !== undefined;
		parameters.morphTargetsCount = morphTargetsCount;
		parameters.morphTextureStride = morphTextureStride;
		parameters.numSunLights = lights.sun.length;
		parameters.numDirLights = lights.directional.length;
		parameters.numPointLights = lights.point.length;
		parameters.numSpotLights = lights.spot.length;
		parameters.numSpotLightMaps = lights.spotLightMap.length;
		parameters.numRectAreaLights = lights.rectArea.length;
		parameters.numHemiLights = lights.hemi.length;
		parameters.numSunLightShadows = lights.sunShadowMap.length;
		parameters.numDirLightShadows = lights.directionalShadowMap.length;
		parameters.numPointLightShadows = lights.pointShadowMap.length;
		parameters.numSpotLightShadows = lights.spotShadowMap.length;
		parameters.numSpotLightShadowsWithMaps = lights.numSpotLightShadowsWithMaps;
		parameters.numLightProbes = lights.numLightProbes;
		parameters.numLightProbeGrids = lightProbeGrids.filter( grid => grid.texture !== null ).length;
		parameters.numClippingPlanes = clipping.numPlanes;
		parameters.numClipIntersection = clipping.numIntersection;
		parameters.dithering = material.dithering;
		parameters.shadowMapEnabled = renderer.shadowMap.enabled && shadows.length > 0;
		parameters.shadowMapType = renderer.shadowMap.type;
		parameters.toneMapping = toneMapping;
		parameters.decodeVideoTexture = HAS_MAP && ( material.map.isVideoTexture === true ) && ( ColorManagement.getTransfer( material.map.colorSpace ) === SRGBTransfer );
		parameters.decodeVideoTextureEmissive = HAS_EMISSIVEMAP && ( material.emissiveMap.isVideoTexture === true ) && ( ColorManagement.getTransfer( material.emissiveMap.colorSpace ) === SRGBTransfer );
		parameters.premultipliedAlpha = material.premultipliedAlpha;
		parameters.doubleSided = material.side === DoubleSide;
		parameters.flipSided = material.side === BackSide;
		parameters.useDepthPacking = material.depthPacking >= 0;
		parameters.depthPacking = material.depthPacking || 0;
		parameters.index0AttributeName = material.index0AttributeName;
		parameters.extensionClipCullDistance = HAS_EXTENSIONS && material.extensions.clipCullDistance === true && extensions.has( 'WEBGL_clip_cull_distance' );
		parameters.extensionMultiDraw = ( HAS_EXTENSIONS && material.extensions.multiDraw === true || IS_BATCHEDMESH ) && extensions.has( 'WEBGL_multi_draw' );
		parameters.rendererExtensionParallelShaderCompile = extensions.has( 'KHR_parallel_shader_compile' );
		parameters.customProgramCacheKey = material.customProgramCacheKey();

		// the usage of getChannel() determines the active texture channels for this shader

		parameters.vertexUv1s = _activeChannels.has( 1 );
		parameters.vertexUv2s = _activeChannels.has( 2 );
		parameters.vertexUv3s = _activeChannels.has( 3 );

		_activeChannels.clear();

		if ( maxInactivePrograms > 0 && customVertexShaderStage !== undefined ) {

			// Keep the stages used for the cache key, before onBeforeCompile changes source.
			parameters.customVertexShaderStage = customVertexShaderStage;
			parameters.customFragmentShaderStage = customFragmentShaderStage;

		}

		return parameters;

	}

	function getProgramCacheKey( parameters ) {

		const array = [];

		if ( parameters.shaderID ) {

			array.push( parameters.shaderID );

		} else {

			array.push( parameters.customVertexShaderID );
			array.push( parameters.customFragmentShaderID );

		}

		if ( parameters.defines !== undefined ) {

			for ( const name in parameters.defines ) {

				array.push( name );
				array.push( parameters.defines[ name ] );

			}

		}

		if ( parameters.isRawShaderMaterial === false ) {

			getProgramCacheKeyParameters( array, parameters );
			getProgramCacheKeyBooleans( array, parameters );
			array.push( renderer.outputColorSpace );

		}

		array.push( parameters.customProgramCacheKey );

		return array.join();

	}

	function getProgramCacheKeyParameters( array, parameters ) {

		array.push( parameters.precision );
		array.push( parameters.outputColorSpace );
		array.push( parameters.envMapMode );
		array.push( parameters.envMapPMREM );
		array.push( parameters.envMapMaxLod );
		array.push( parameters.envMapSize );
		array.push( parameters.mapUv );
		array.push( parameters.alphaMapUv );
		array.push( parameters.lightMapUv );
		array.push( parameters.aoMapUv );
		array.push( parameters.bumpMapUv );
		array.push( parameters.normalMapUv );
		array.push( parameters.displacementMapUv );
		array.push( parameters.emissiveMapUv );
		array.push( parameters.metalnessMapUv );
		array.push( parameters.roughnessMapUv );
		array.push( parameters.anisotropyMapUv );
		array.push( parameters.clearcoatMapUv );
		array.push( parameters.clearcoatNormalMapUv );
		array.push( parameters.clearcoatRoughnessMapUv );
		array.push( parameters.diffuseRoughnessMapUv );
		array.push( parameters.iridescenceMapUv );
		array.push( parameters.iridescenceThicknessMapUv );
		array.push( parameters.sheenColorMapUv );
		array.push( parameters.sheenRoughnessMapUv );
		array.push( parameters.specularMapUv );
		array.push( parameters.specularColorMapUv );
		array.push( parameters.specularIntensityMapUv );
		array.push( parameters.transmissionMapUv );
		array.push( parameters.thicknessMapUv );
		array.push( parameters.combine );
		array.push( parameters.fogExp2 );
		array.push( parameters.sizeAttenuation );
		array.push( parameters.morphTargetsCount );
		array.push( parameters.numSunLights );
		array.push( parameters.numDirLights );
		array.push( parameters.numPointLights );
		array.push( parameters.numSpotLights );
		array.push( parameters.numSpotLightMaps );
		array.push( parameters.numHemiLights );
		array.push( parameters.numRectAreaLights );
		array.push( parameters.numSunLightShadows );
		array.push( parameters.numDirLightShadows );
		array.push( parameters.numPointLightShadows );
		array.push( parameters.numSpotLightShadows );
		array.push( parameters.numSpotLightShadowsWithMaps );
		array.push( parameters.numLightProbes );
		array.push( parameters.numLightProbeGrids );
		array.push( parameters.shadowMapType );
		array.push( parameters.toneMapping );
		array.push( parameters.numClippingPlanes );
		array.push( parameters.numClipIntersection );
		array.push( parameters.depthPacking );

	}

	function getProgramCacheKeyBooleans( array, parameters ) {

		_programLayers.disableAll();

		if ( parameters.instancing )
			_programLayers.enable( 0 );
		if ( parameters.instancingColor )
			_programLayers.enable( 1 );
		if ( parameters.instancingMorph )
			_programLayers.enable( 2 );
		if ( parameters.matcap )
			_programLayers.enable( 3 );
		if ( parameters.envMap )
			_programLayers.enable( 4 );
		if ( parameters.normalMapObjectSpace )
			_programLayers.enable( 5 );
		if ( parameters.normalMapTangentSpace )
			_programLayers.enable( 6 );
		if ( parameters.clearcoat )
			_programLayers.enable( 7 );
		if ( parameters.iridescence )
			_programLayers.enable( 8 );
		if ( parameters.alphaTest )
			_programLayers.enable( 9 );
		if ( parameters.vertexColors )
			_programLayers.enable( 10 );
		if ( parameters.vertexAlphas )
			_programLayers.enable( 11 );
		if ( parameters.vertexUv1s )
			_programLayers.enable( 12 );
		if ( parameters.vertexUv2s )
			_programLayers.enable( 13 );
		if ( parameters.vertexUv3s )
			_programLayers.enable( 14 );
		if ( parameters.vertexTangents )
			_programLayers.enable( 15 );
		if ( parameters.anisotropy )
			_programLayers.enable( 16 );
		if ( parameters.alphaHash )
			_programLayers.enable( 17 );
		if ( parameters.batching )
			_programLayers.enable( 18 );
		if ( parameters.dispersion )
			_programLayers.enable( 19 );
		if ( parameters.retroreflection )
			_programLayers.enable( 24 );
		if ( parameters.diffuseRoughness )
			_programLayers.enable( 25 );
		if ( parameters.batchingColor )
			_programLayers.enable( 20 );
		if ( parameters.gradientMap )
			_programLayers.enable( 21 );
		if ( parameters.packedNormalMap )
			_programLayers.enable( 22 );
		if ( parameters.vertexNormals )
			_programLayers.enable( 23 );

		array.push( _programLayers.mask );
		_programLayers.disableAll();

		if ( parameters.fog )
			_programLayers.enable( 0 );
		if ( parameters.useFog )
			_programLayers.enable( 1 );
		if ( parameters.flatShading )
			_programLayers.enable( 2 );
		if ( parameters.logarithmicDepthBuffer )
			_programLayers.enable( 3 );
		if ( parameters.reversedDepthBuffer )
			_programLayers.enable( 4 );
		if ( parameters.skinning )
			_programLayers.enable( 5 );
		if ( parameters.morphTargets )
			_programLayers.enable( 6 );
		if ( parameters.morphNormals )
			_programLayers.enable( 7 );
		if ( parameters.morphColors )
			_programLayers.enable( 8 );
		if ( parameters.premultipliedAlpha )
			_programLayers.enable( 9 );
		if ( parameters.shadowMapEnabled )
			_programLayers.enable( 10 );
		if ( parameters.doubleSided )
			_programLayers.enable( 11 );
		if ( parameters.flipSided )
			_programLayers.enable( 12 );
		if ( parameters.useDepthPacking )
			_programLayers.enable( 13 );
		if ( parameters.dithering )
			_programLayers.enable( 14 );
		if ( parameters.transmission )
			_programLayers.enable( 15 );
		if ( parameters.sheen )
			_programLayers.enable( 16 );
		if ( parameters.opaque )
			_programLayers.enable( 17 );
		if ( parameters.pointsUvs )
			_programLayers.enable( 18 );
		if ( parameters.decodeVideoTexture )
			_programLayers.enable( 19 );
		if ( parameters.decodeVideoTextureEmissive )
			_programLayers.enable( 20 );
		if ( parameters.alphaToCoverage )
			_programLayers.enable( 21 );
		if ( parameters.numLightProbeGrids > 0 )
			_programLayers.enable( 22 );
		if ( parameters.hasPositionAttribute )
			_programLayers.enable( 23 );

		array.push( _programLayers.mask );

	}

	function getUniforms( material ) {

		const shaderID = shaderIDs[ material.type ];
		let uniforms;

		if ( shaderID ) {

			const shader = ShaderLib[ shaderID ];
			uniforms = UniformsUtils.clone( shader.uniforms );

		} else {

			uniforms = material.uniforms;

		}

		return uniforms;

	}

	function acquireProgram( parameters, cacheKey ) {

		let program = programsMap.get( cacheKey );

		if ( program !== undefined ) {

			inactivePrograms.delete( cacheKey );
			++ program.usedTimes;

		} else {

			program = new WebGLProgram( renderer, cacheKey, pooledParameters.has( parameters ) ? copyParameters( parameters ) : parameters, bindingStates );
			programs.push( program );

			programsMap.set( cacheKey, program );

			if ( maxInactivePrograms > 0 && parameters.customVertexShaderStage !== undefined ) {

				// ShaderMaterial IDs must survive until the retained program is evicted.
				_customShaders.update( program, parameters.customVertexShaderStage, parameters.customFragmentShaderStage );
				programShaderReferences.add( program );

			}

		}

		return program;

	}

	function destroyProgram( program, index = programs.indexOf( program ) ) {

		// Remove from unordered set and both lookup maps.
		programs[ index ] = programs[ programs.length - 1 ];
		programs.pop();
		programsMap.delete( program.cacheKey );
		inactivePrograms.delete( program.cacheKey );

		if ( programShaderReferences.delete( program ) ) _customShaders.remove( program );

		program.destroy();

	}

	function releaseProgram( program ) {

		// Renderer disposal can precede the material's dispose event.
		if ( programsMap.get( program.cacheKey ) !== program ) return;

		if ( -- program.usedTimes === 0 ) {

			if ( maxInactivePrograms === 0 || program.diagnostics?.runnable === false ) {

				destroyProgram( program );

			} else {

				// Retain compiled programs only, without their geometry binding states.
				bindingStates.releaseStatesOfProgram( program );
				inactivePrograms.set( program.cacheKey, program );

				while ( inactivePrograms.size > maxInactivePrograms ) {

					destroyProgram( inactivePrograms.values().next().value );

				}

			}

		}

	}

	function releaseShaderCache( material ) {

		_customShaders.remove( material );

	}

	function dispose() {

		while ( programs.length > 0 ) {

			// The tail index is known; avoid repeated linear searches during bulk disposal.
			const index = programs.length - 1;
			destroyProgram( programs[ index ], index );

		}

		_customShaders.dispose();
		parameterPool.length = 0;

	}

	return {
		getParameters: getParameters,
		acquireParameters: acquireParameters,
		releaseParameters: releaseParameters,
		copyParameters: copyParameters,
		getProgramCacheKey: getProgramCacheKey,
		getUniforms: getUniforms,
		acquireProgram: acquireProgram,
		releaseProgram: releaseProgram,
		releaseShaderCache: releaseShaderCache,
		// Exposed for resource monitoring & error feedback via renderer.info:
		programs: programs,
		dispose: dispose
	};

}

export { WebGLPrograms };
