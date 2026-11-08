import { WebGLPrograms } from '../../../../../src/renderers/webgl/WebGLPrograms.js';
import { WebGLRenderer, Material, ShaderMaterial, RawShaderMaterial, MeshBasicMaterial, Scene, Mesh, PlaneGeometry, OrthographicCamera, SRGBColorSpace, NoToneMapping } from '../../../../../src/Three.js';

function parametersFixture( budget = 2 ) {

	const renderer = { getRenderTarget: () => null, state: { buffers: { depth: { getReversed: () => false } } }, outputColorSpace: SRGBColorSpace, toneMapping: NoToneMapping, shadowMap: { enabled: false, type: 1 } };
	const lights = { sun: [], directional: [], point: [], spot: [], spotLightMap: [], rectArea: [], hemi: [], sunShadowMap: [], directionalShadowMap: [], pointShadowMap: [], spotShadowMap: [], numSpotLightShadowsWithMaps: 0, numLightProbes: 0 };
	const cache = new WebGLPrograms( renderer, { get: () => null }, { has: () => false }, { precision: 'highp', getMaxPrecision: value => value }, {}, { numPlanes: 0, numIntersection: 0 }, budget );
	const geometry = new PlaneGeometry(), scene = new Scene();
	return { cache,
		get( material, method = 'acquireParameters' ) {

			return cache[ method ]( material, lights, [], scene, { geometry }, [] );

		},
		dispose() {

			cache.dispose(); geometry.dispose();

		}
	};

}

function shader( color ) {

	return new ShaderMaterial( {
		vertexShader: 'void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
		fragmentShader: `void main(){ gl_FragColor=vec4(${ color },1.0); }`
	} );

}

function renderFixture() {

	const renderer = new WebGLRenderer( { maxInactivePrograms: 2 } );
	renderer.setSize( 8, 8 );
	const scene = new Scene(), geometry = new PlaneGeometry( 2, 2 ), camera = new OrthographicCamera( - 1, 1, 1, - 1, 0.1, 10 );
	camera.position.z = 2;
	const mesh = new Mesh( geometry );
	scene.add( mesh );
	return { renderer, scene, mesh, camera,
		draw( material ) {

			mesh.material = material;
			renderer.render( scene, camera );
			const gl = renderer.getContext(), pixel = new Uint8Array( 4 );
			gl.readPixels( 4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );
			return Array.from( pixel );

		},
		dispose() {

			geometry.dispose(); renderer.dispose(); renderer.forceContextLoss();

		}
	};

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'WebGLParameterPool', () => {

		QUnit.test( 'active leases stay independent and retained scratch storage is bounded', assert => {

			const f = parametersFixture(), material = shader( '1.0,0.0,0.0' );
			try {

				const active = Array.from( { length: 6 }, () => f.get( material ) );
				assert.strictEqual( new Set( active ).size, 6 );
				for ( const record of active ) f.cache.releaseParameters( record );
				for ( const key of [ 'defines', 'uniforms', 'vertexShader', 'fragmentShader', 'customVertexShaderStage', 'customFragmentShaderStage', 'shaderName', 'shaderType', 'customProgramCacheKey' ] ) assert.strictEqual( active[ 0 ][ key ], undefined, key + ' is cleared' );
				const next = Array.from( { length: 6 }, () => f.get( material ) );
				assert.strictEqual( new Set( next ).size, 6 );
				assert.strictEqual( next.filter( p => active.includes( p ) ).length, 4 );
				for ( const record of next ) f.cache.releaseParameters( record );
				f.cache.dispose();
				const fresh = f.get( material );
				assert.false( next.includes( fresh ), 'dispose empties retained scratch storage' );
				f.cache.releaseParameters( fresh );
				assert.notStrictEqual( f.get( material, 'getParameters' ), f.get( material, 'getParameters' ), 'ordinary parameter queries remain independent' );

			} finally {

				f.dispose();

			}

		} );

		QUnit.test( 'owned copies preserve field presence, order and values across material types', assert => {

			for ( const budget of [ 0, 2 ] ) {

				const f = parametersFixture( budget );
				try {

					for ( const material of [ shader( '1.0,0.0,0.0' ), new MeshBasicMaterial(), new RawShaderMaterial(), new MeshBasicMaterial() ] ) {

						const leased = f.get( material ), fresh = f.get( material, 'getParameters' );
						leased.uniforms = fresh.uniforms = material.uniforms || {};
						const copy = f.cache.copyParameters( leased );
						assert.strictEqual( Object.getPrototypeOf( copy ), Object.prototype );
						assert.deepEqual( Object.keys( copy ), Object.keys( fresh ) );
						assert.deepEqual( copy, fresh );
						f.cache.releaseParameters( leased );
						assert.strictEqual( copy.vertexShader, fresh.vertexShader, 'release preserves owned shader source' );

					}

				} finally {

					f.dispose();

				}

			}

		} );

		QUnit.test( 'failed parameter preparation returns borrowed storage safely', assert => {

			const f = parametersFixture(), material = shader( '1.0,0.0,0.0' );
			try {

				const before = f.get( material );
				f.cache.releaseParameters( before );
				const invalid = shader( '0.0,0.0,1.0' );
				Object.defineProperty( invalid, 'precision', { get() {

					throw new Error( 'precision failure' );

				} } );
				assert.throws( () => f.get( invalid ), /precision failure/ );
				const after = f.get( material );
				assert.strictEqual( after, before );
				assert.strictEqual( after.fragmentShader, material.fragmentShader );
				f.cache.releaseParameters( after );

			} finally {

				f.dispose();

			}

		} );

		const context = document.createElement( 'canvas' ).getContext( 'webgl2' );
		const gpuTest = context ? QUnit.test : QUnit.skip;
		context?.getExtension( 'WEBGL_lose_context' )?.loseContext();

		gpuTest( 'custom hooks may retain and freeze independent records', assert => {

			const f = renderFixture(), custom = shader( '1.0,0.0,0.0' ), records = [];
			custom.onBeforeCompile = parameters => {

				parameters.fragmentShader = parameters.fragmentShader.replace( '1.0,0.0,0.0', '0.0,1.0,0.0' );
				records.push( Object.freeze( parameters ) );

			};

			try {

				assert.deepEqual( f.draw( custom ), [ 0, 255, 0, 255 ] );
				const source = records[ 0 ].fragmentShader, uniforms = records[ 0 ].uniforms;
				for ( let i = 0; i < 8; i ++ ) {

					const next = shader( '0.0,0.0,1.0' );
					assert.deepEqual( f.draw( next ), [ 0, 0, 255, 255 ] );
					next.dispose();

				}

				custom.defines.MODE = 1;
				custom.needsUpdate = true;
				assert.deepEqual( f.draw( custom ), [ 0, 255, 0, 255 ] );
				assert.notStrictEqual( records[ 0 ], records[ 1 ] );
				assert.strictEqual( records[ 0 ].fragmentShader, source );
				assert.strictEqual( records[ 0 ].uniforms, uniforms );
				assert.strictEqual( f.renderer.getContext().getError(), 0 );

			} finally {

				custom.dispose(); f.dispose();

			}

		} );

		gpuTest( 'prototype hooks retain ownership and throwing hooks release scratch records', assert => {

			const f = renderFixture(), original = Material.prototype.onBeforeCompile, records = [], material = shader( '0.0,1.0,0.0' );
			try {

				Material.prototype.onBeforeCompile = parameters => records.push( parameters );
				assert.deepEqual( f.draw( material ), [ 0, 255, 0, 255 ] );
				const first = records[ 0 ];
				Material.prototype.onBeforeCompile = original;
				const bad = shader( '1.0,0.0,0.0' );
				bad.onBeforeCompile = parameters => {

					records.push( parameters ); throw new Error( 'compile hook failure' );

				};

				assert.throws( () => f.draw( bad ), /compile hook failure/ );
				bad.dispose();
				const next = shader( '0.0,0.0,1.0' );
				assert.deepEqual( f.draw( next ), [ 0, 0, 255, 255 ] );
				next.dispose();
				assert.strictEqual( first.fragmentShader, material.fragmentShader );
				assert.true( records[ 1 ].fragmentShader.includes( '1.0,0.0,0.0' ) );
				assert.notStrictEqual( records[ 0 ], records[ 1 ] );
				assert.strictEqual( f.renderer.getContext().getError(), 0 );

			} finally {

				Material.prototype.onBeforeCompile = original; material.dispose(); f.dispose();

			}

		} );

		gpuTest( 'nested compilation keeps parent and child shader state independent', assert => {

			const f = renderFixture(), nested = new Scene(), parent = shader( '0.0,1.0,0.0' ), child = shader( '0.0,0.0,1.0' );
			const mesh = new Mesh( f.mesh.geometry, child );
			nested.add( mesh );
			let retained;
			parent.onBeforeCompile = parameters => {

				retained = parameters;
				f.renderer.render( nested, f.camera );
				assert.strictEqual( parameters.fragmentShader, parent.fragmentShader );

			};

			try {

				assert.deepEqual( f.draw( parent ), [ 0, 255, 0, 255 ] );
				f.renderer.render( nested, f.camera );
				assert.strictEqual( retained.fragmentShader, parent.fragmentShader );
				assert.deepEqual( f.draw( child ), [ 0, 0, 255, 255 ] );
				assert.strictEqual( f.renderer.getContext().getError(), 0 );

			} finally {

				parent.dispose(); child.dispose(); f.dispose();

			}

		} );

		gpuTest( 'node builders may retain independent parameter records', assert => {

			const f = renderFixture(), node = shader( '0.0,1.0,0.0' ), next = shader( '0.0,0.0,1.0' ), records = [];
			node.isNodeMaterial = true;
			f.renderer.setNodesHandler( {
				setRenderer() {}, renderStart() {}, renderEnd() {}, updateLights() {}, setObject() {}, onUpdateProgram() {},
				build( material, object, parameters ) {

					records.push( parameters );

				}
			} );
			try {

				assert.deepEqual( f.draw( node ), [ 0, 255, 0, 255 ] );
				const retained = records[ 0 ];
				assert.deepEqual( f.draw( next ), [ 0, 0, 255, 255 ] );
				assert.strictEqual( retained.fragmentShader, node.fragmentShader );
				assert.strictEqual( retained.uniforms, node.uniforms );
				assert.strictEqual( f.renderer.getContext().getError(), 0 );

			} finally {

				node.dispose(); next.dispose(); f.dispose();

			}

		} );

	} );

} );
