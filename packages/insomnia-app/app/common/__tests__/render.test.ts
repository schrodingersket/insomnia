import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import * as renderUtils from '../render';

jest.mock('electron');

describe('render()', () => {
  beforeEach(globalBeforeEach);

  it('renders hello world', async () => {
    const rendered = await renderUtils.render('Hello {{ msg }}!', {
      msg: 'World',
    });
    expect(rendered).toBe('Hello World!');
  });

  it('renders custom tag: uuid', async () => {
    const rendered = await renderUtils.render('Hello {% uuid %}!');
    expect(rendered).toMatch(/Hello [a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}!/);
  });

  it('renders custom tag: timestamp', async () => {
    const rendered = await renderUtils.render('Hello {% timestamp %}!');
    expect(rendered).toMatch(/Hello \d{13}!/);
  });

  it('renders nested object', async () => {
    const rendered = await renderUtils.render('Hello {{ users[0].name }}!', {
      users: [
        {
          name: 'Niji',
        },
      ],
    });
    expect(rendered).toBe('Hello Niji!');
  });

  it('fails on invalid template', async () => {
    try {
      await renderUtils.render('Hello {{ msg }!', {
        msg: 'World',
      });
      fail('Render should have failed');
    } catch (err) {
      expect(err.message).toContain('expected variable end');
    }
  });

  it('handles variables using tag before tag is defined as expected (incorrect order)', async () => {
    const rootEnvironment = {
      type: models.environment.type,
      data: {
        consume: '{{ replaced }}',
        hashed: "{% hash 'md5', 'hex', value %}",
        replaced: "{{ hashed | replace('f67565de946a899a534fd908e7eef872', 'cat') }}",
        value: 'ThisIsATopSecretValue',
      },
      dataPropertyOrder: {
        '&': ['value', 'replaced', 'hashed', 'consume'],
      },
    };
    const context = await renderUtils.buildRenderContext([], rootEnvironment);
    expect(context).toEqual({
      value: 'ThisIsATopSecretValue',
      hashed: 'f67565de946a899a534fd908e7eef872',
      replaced: 'f67565de946a899a534fd908e7eef872',
      consume: 'f67565de946a899a534fd908e7eef872',
    });
    // In runtime, this context is used to render, which re-evaluates the expression for replaced in the rootEnvironment by using the built context
    // Regression test from issue 1917 - https://github.com/Kong/insomnia/issues/1917
    const renderExpression = await renderUtils.render(rootEnvironment.data.replaced, context);
    expect(renderExpression).toBe('cat');
  });
});

describe('buildRenderContext()', () => {
  beforeEach(globalBeforeEach);

  it('cascades properly', async () => {
    const ancestors = [
      {
        type: models.requestGroup.type,
        environment: {
          foo: 'parent',
          ancestor: true,
        },
      },
      {
        type: models.requestGroup.type,
        environment: {
          foo: 'grandparent',
          ancestor: true,
        },
      },
    ];
    const rootEnvironment = {
      type: models.environment.type,
      data: {
        foo: 'root',
        root: true,
      },
    };
    const subEnvironment = {
      type: models.environment.type,
      data: {
        foo: 'sub',
        sub: true,
      },
    };
    const context = await renderUtils.buildRenderContext(
      ancestors,
      rootEnvironment,
      subEnvironment,
    );
    expect(context).toEqual({
      foo: 'parent',
      ancestor: true,
      root: true,
      sub: true,
    });
  });

  it('rendered recursive should not infinite loop', async () => {
    const ancestors = [
      {
        // Sub Environment
        type: models.requestGroup.type,
        environment: {
          recursive: '{{ recursive }}/hello',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    // This is longer than 3 because it multiplies every time (1 -> 2 -> 4 -> 8)
    expect(context).toEqual({
      recursive: '{{ recursive }}/hello/hello/hello/hello/hello/hello/hello/hello',
    });
  });

  it('does not recursive render if itself is not used in var', async () => {
    const root = {
      type: models.environment.type,
      data: {
        proto: 'http',
        domain: 'base.com',
        url: '{{ proto }}://{{ domain }}',
      },
    };
    const sub = {
      type: models.environment.type,
      data: {
        proto: 'https',
        domain: 'sub.com',
        port: 8000,
        url: '{{ proto }}://{{ domain }}:{{ port }}',
      },
    };
    const ancestors = [
      {
        // Folder Environment
        type: models.requestGroup.type,
        environment: {
          proto: 'https',
          domain: 'folder.com',
          port: 7000,
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors, root, sub);
    expect(context).toEqual({
      proto: 'https',
      domain: 'folder.com',
      port: 7000,
      url: 'https://folder.com:7000',
    });
  });

  it('does the thing', async () => {
    const root = {
      type: models.environment.type,
      data: {
        url: 'insomnia.rest',
      },
    };
    const sub = {
      type: models.environment.type,
      data: {
        url: '{{ url }}/sub',
      },
    };
    const ancestors = [
      {
        // Folder Environment
        type: models.requestGroup.type,
        environment: {
          url: '{{ url }}/{{ name }}',
          name: 'folder',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors, root, sub);
    expect(context).toEqual({
      url: 'insomnia.rest/sub/folder',
      name: 'folder',
    });
  });

  it('render up to 3 recursion levels', async () => {
    const ancestors = [
      {
        // Sub Environment
        type: models.requestGroup.type,
        environment: {
          d: '/d',
          c: '/c{{ d }}',
          b: '/b{{ c }}',
          a: '/a{{ b }}',
          test: 'http://insomnia.rest{{ a }}',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      d: '/d',
      c: '/c/d',
      b: '/b/c/d',
      a: '/a/b/c/d',
      test: 'http://insomnia.rest/a/b/c/d',
    });
  });

  it('rendered sibling environment variables', async () => {
    const ancestors = [
      {
        // Sub Environment
        type: models.requestGroup.type,
        environment: {
          sibling: 'sibling',
          test: '{{ sibling }}/hello',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      sibling: 'sibling',
      test: 'sibling/hello',
    });
  });

  it('rendered parent environment variables', async () => {
    const ancestors = [
      {
        name: 'Parent',
        type: models.requestGroup.type,
        environment: {
          test: '{{ grandparent }} parent',
        },
      },
      {
        name: 'Grandparent',
        type: models.requestGroup.type,
        environment: {
          grandparent: 'grandparent',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      grandparent: 'grandparent',
      test: 'grandparent parent',
    });
  });

  it('rendered parent same name environment variables', async () => {
    const ancestors = [
      {
        name: 'Parent',
        type: models.requestGroup.type,
        environment: {
          base_url: '{{ base_url }}/resource',
        },
      },
      {
        name: 'Grandparent',
        type: models.requestGroup.type,
        environment: {
          base_url: 'https://insomnia.rest',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      base_url: 'https://insomnia.rest/resource',
    });
  });

  it('rendered parent, ignoring sibling environment variables', async () => {
    const ancestors = [
      {
        name: 'Parent',
        type: models.requestGroup.type,
        environment: {
          host: 'parent.com',
        },
      },
      {
        name: 'Grandparent',
        type: models.requestGroup.type,
        environment: {
          host: 'grandparent.com',
          node: {
            admin: 'admin',
            test: 'test',
            port: 8080,
          },
          urls: {
            admin: 'https://{{ host }}/{{ node.admin }}',
            test: 'https://{{ host }}/{{ node.test }}',
          },
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(await renderUtils.render('{{ urls.admin }}/foo', context)).toBe(
      'https://parent.com/admin/foo',
    );
    expect(await renderUtils.render('{{ urls.test }}/foo', context)).toBe(
      'https://parent.com/test/foo',
    );
  });

  it('renders child environment variables', async () => {
    const ancestors = [
      {
        name: 'Parent',
        type: models.requestGroup.type,
        environment: {
          parent: 'parent',
        },
      },
      {
        name: 'Grandparent',
        type: models.requestGroup.type,
        environment: {
          test: '{{ parent }} grandparent',
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      parent: 'parent',
      test: 'parent grandparent',
    });
  });

  it('works with object arrays', async () => {
    const ancestors = [
      {
        name: 'Parent',
        type: models.requestGroup.type,
        environment: {},
      },
      {
        name: 'Grandparent',
        type: models.requestGroup.type,
        environment: {
          users: [
            {
              name: 'Mike',
            },
            {
              name: 'Opender',
            },
          ],
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      users: [
        {
          name: 'Mike',
        },
        {
          name: 'Opender',
        },
      ],
    });
  });

  it('works with ordered objects', async () => {
    const obj = {
      users: [
        {
          name: 'Mike',
          id: 1,
        },
        {
          name: 'Opender',
          id: 2,
        },
      ],
    };
    const order = {
      '&': ['users'],
      '&~|users~|0': ['id', 'name'],
      '&~|users~|1': ['id', 'name'],
    };
    const requestGroup = {
      name: 'Parent',
      type: models.requestGroup.type,
      environment: obj,
      environmentPropertyOrder: order,
    };
    const rootEnvironment = {
      name: 'Parent',
      type: models.environment.type,
      data: obj,
      dataPropertyOrder: order,
    };
    const subEnvironment = {
      name: 'Sub',
      type: models.environment.type,
      data: obj,
      dataPropertyOrder: order,
    };
    const groupCtx = await renderUtils.buildRenderContext([requestGroup]);
    const rootCtx = await renderUtils.buildRenderContext([], rootEnvironment);
    const subCtx = await renderUtils.buildRenderContext([], null, subEnvironment);
    const expected = {
      users: [
        {
          id: 1,
          name: 'Mike',
        },
        {
          id: 2,
          name: 'Opender',
        },
      ],
    };
    expect(groupCtx).toEqual(expected);
    expect(rootCtx).toEqual(expected);
    expect(subCtx).toEqual(expected);
  });

  it('merges nested properties when rendering', async () => {
    const ancestors = [
      {
        name: 'Parent',
        type: models.requestGroup.type,
        environment: {
          parent: 'parent',
          nested: {
            common: 'parent',
            parentA: 'pa',
            parentB: 'pb',
          },
        },
      },
      {
        name: 'Grandparent',
        type: models.requestGroup.type,
        environment: {
          test: '{{ parent }} grandparent',
          nested: {
            common: 'grandparent',
            grandParentA: 'gpa',
            grandParentB: 'gpb',
          },
        },
      },
    ];
    const context = await renderUtils.buildRenderContext(ancestors);
    expect(context).toEqual({
      parent: 'parent',
      test: 'parent grandparent',
      nested: {
        common: 'parent',
        grandParentA: 'gpa',
        grandParentB: 'gpb',
        parentA: 'pa',
        parentB: 'pb',
      },
    });
  });

  it('cascades properly and renders', async () => {
    const ancestors = [
      {
        type: models.requestGroup.type,
        environment: {
          url: '{{ base_url }}/resource',
          ancestor: true,
          winner: 'folder parent',
        },
      },
      {
        type: models.requestGroup.type,
        environment: {
          ancestor: true,
          winner: 'folder grandparent',
        },
      },
    ];
    const subEnvironment = {
      type: models.environment.type,
      data: {
        winner: 'sub',
        sub: true,
        base_url: 'https://insomnia.rest',
      },
    };
    const rootEnvironment = {
      type: models.environment.type,
      data: {
        winner: 'root',
        root: true,
        base_url: 'ignore this',
      },
    };
    const context = await renderUtils.buildRenderContext(
      ancestors,
      rootEnvironment,
      subEnvironment,
    );
    expect(context).toEqual({
      base_url: 'https://insomnia.rest',
      url: 'https://insomnia.rest/resource',
      ancestor: true,
      winner: 'folder parent',
      root: true,
      sub: true,
    });
  });

  it('handles variables using tag after tag is defined as expected (correct order)', async () => {
    const rootEnvironment = {
      type: models.environment.type,
      data: {
        consume: '{{ replaced }}',
        hashed: "{% hash 'md5', 'hex', value %}",
        replaced: "{{ hashed | replace('f67565de946a899a534fd908e7eef872', 'cat') }}",
        value: 'ThisIsATopSecretValue',
      },
      dataPropertyOrder: {
        '&': ['value', 'hashed', 'replaced', 'consume'],
      },
    };
    const context = await renderUtils.buildRenderContext([], rootEnvironment);
    expect(context).toEqual({
      value: 'ThisIsATopSecretValue',
      hashed: 'f67565de946a899a534fd908e7eef872',
      replaced: 'cat',
      consume: 'cat',
    });
  });

  it('handles variables being used in tags', async () => {
    const rootEnvironment = {
      type: models.environment.type,
      data: {
        hash_input: '{{ orderId }}{{ secret }}',
        hash_input_expected: '123456789012345ThisIsATopSecretValue',
        orderId: 123456789012345,
        password: "{% hash 'sha512', 'hex', hash_input %}",
        password_expected: "{% hash 'sha512', 'hex', hash_input_expected %}",
        secret: 'ThisIsATopSecretValue',
      },
    };
    const context = await renderUtils.buildRenderContext([], rootEnvironment);
    expect(context).toEqual({
      hash_input: '123456789012345ThisIsATopSecretValue',
      hash_input_expected: '123456789012345ThisIsATopSecretValue',
      orderId: 123456789012345,
      password:
        'ea84d15f33d3f9e9098fe01659b1ea0599d345770bba20ba98bf9056676a83ffe6b5528b2451ad04badbf690cf3009a94c510121cc6897045f8bb4ba0826134c',
      password_expected:
        'ea84d15f33d3f9e9098fe01659b1ea0599d345770bba20ba98bf9056676a83ffe6b5528b2451ad04badbf690cf3009a94c510121cc6897045f8bb4ba0826134c',
      secret: 'ThisIsATopSecretValue',
    });
  });

  it('works with minimal parameters', async () => {
    const ancestors = null;
    const rootEnvironment = null;
    const subEnvironment = null;
    const context = await renderUtils.buildRenderContext(
      ancestors,
      rootEnvironment,
      subEnvironment,
    );
    expect(context).toEqual({});
  });
});

describe('render()', () => {
  beforeEach(globalBeforeEach);

  it('correctly renders simple Object', async () => {
    const newObj = await renderUtils.render(
      {
        foo: '{{ foo }}',
        bar: 'bar',
        baz: '{{ bad }}',
      },
      {
        foo: 'bar',
        bad: 'hi',
      },
    );
    expect(newObj).toEqual({
      foo: 'bar',
      bar: 'bar',
      baz: 'hi',
    });
  });

  it('correctly renders complex Object', async () => {
    const d = new Date();
    const obj = {
      foo: '{{ foo }}',
      null: null,
      bool: true,
      date: d,
      undef: undefined,
      num: 1234,
      nested: {
        foo: '{{ foo }}',
        arr: [1, 2, '{{ foo }}'],
      },
    };
    const newObj = await renderUtils.render(obj, {
      foo: 'bar',
    });
    expect(newObj).toEqual({
      foo: 'bar',
      null: null,
      bool: true,
      date: d,
      undef: undefined,
      num: 1234,
      nested: {
        foo: 'bar',
        arr: [1, 2, 'bar'],
      },
    });
    // Make sure original request isn't changed
    expect(obj.foo).toBe('{{ foo }}');
    expect(obj.nested.foo).toBe('{{ foo }}');
    expect(obj.nested.arr[2]).toBe('{{ foo }}');
  });

  it('fails on bad template', async () => {
    try {
      await renderUtils.render(
        {
          foo: '{{ foo }',
          bar: 'bar',
          baz: '{{ bad }}',
        },
        {
          foo: 'bar',
        },
      );
      fail('Render should have failed');
    } catch (err) {
      expect(err.message).toContain('expected variable end');
    }
  });

  it('keep on error setting', async () => {
    const template = '{{ foo }} {% invalid "hi" %}';
    const context = {
      foo: 'bar',
    };
    const resultOnlyVars = await renderUtils.render(
      template,
      context,
      null,
      renderUtils.KEEP_ON_ERROR,
    );
    expect(resultOnlyVars).toBe('{{ foo }} {% invalid "hi" %}');

    try {
      await renderUtils.render(template, context, null);
      fail('Render should not have succeeded');
    } catch (err) {
      expect(err.message).toBe('unknown block tag: invalid');
    }
  });

  it('outputs correct error path', async () => {
    const template = {
      foo: [
        {
          bar: '{% foo %}',
        },
      ],
    };

    try {
      await renderUtils.render(template);
      fail('Should have failed to render');
    } catch (err) {
      expect(err.path).toBe('foo[0].bar');
    }
  });

  it('outputs correct error path when private first node', async () => {
    const template = {
      _foo: {
        _bar: {
          baz: '{% foo %}',
        },
      },
    };

    try {
      await renderUtils.render(template);
      fail('Should have failed to render');
    } catch (err) {
      expect(err.path).toBe('_bar.baz');
    }
  });
});

describe('getRenderedGrpcRequestMessage()', () => {
  beforeEach(globalBeforeEach);

  it('renders only the body for a grpc request ', async () => {
    const w1 = await models.workspace.create();
    const env = await models.environment.create({
      parentId: w1._id,
      data: {
        foo: 'bar',
        host: 'testb.in:9000',
      },
    });
    const grpcRequest = await models.grpcRequest.create({
      parentId: w1._id,
      name: 'hi {{ foo }}',
      url: '{{ host }}',
      description: 'hi {{ foo }}',
      body: {
        text: '{ "prop": "{{ foo }}" }',
      },
    });
    const request = await renderUtils.getRenderedGrpcRequestMessage(grpcRequest, env._id);
    expect(request).toEqual(
      expect.objectContaining({
        text: '{ "prop": "bar" }',
      }),
    );
  });
});

describe('getRenderedGrpcRequest()', () => {
  let w1, env;
  beforeEach(async () => {
    await globalBeforeEach();
    w1 = await models.workspace.create();
    env = await models.environment.create({
      parentId: w1._id,
      data: {
        foo: 'bar',
        host: 'testb.in:9000',
      },
    });
  });

  it('renders all grpc request properties', async () => {
    const grpcRequest = await models.grpcRequest.create({
      parentId: w1._id,
      name: 'hi {{ foo }}',
      url: '{{ host }}',
      description: 'hi {{ foo }}',
      body: {
        text: '{ "prop": "{{ foo }}" }',
      },
    });
    const request = await renderUtils.getRenderedGrpcRequest(grpcRequest, env._id);
    expect(request).toEqual(
      expect.objectContaining({
        name: 'hi bar',
        url: 'testb.in:9000',
        description: 'hi bar',
        body: {
          text: '{ "prop": "bar" }',
        },
      }),
    );
  });

  it('renders but ignores the body for a grpc request ', async () => {
    const grpcRequest = await models.grpcRequest.create({
      parentId: w1._id,
      name: 'hi {{ foo }}',
      url: '{{ host }}',
      description: 'hi {{ foo }}',
      body: {
        text: '{ "prop": "{{ foo }}" }',
      },
    });
    const request = await renderUtils.getRenderedGrpcRequest(
      grpcRequest,
      env._id,
      null,
      null,
      true,
    );
    expect(request).toEqual(
      expect.objectContaining({
        name: 'hi bar',
        url: 'testb.in:9000',
        description: 'hi bar',
        body: {
          text: '{ "prop": "{{ foo }}" }',
        },
      }),
    );
  });

  it('should still render with bad description', async () => {
    const grpcRequest = await models.grpcRequest.create({
      parentId: w1._id,
      name: 'hi {{ foo }}',
      url: '{{ host }}',
      description: 'hi {{ some error }}',
      body: {
        text: '{ "prop": "{{ foo }}" }',
      },
    });
    const request = await renderUtils.getRenderedGrpcRequest(grpcRequest, env._id);
    expect(request).toEqual(
      expect.objectContaining({
        name: 'hi bar',
        url: 'testb.in:9000',
        description: 'hi {{ some error }}',
        body: {
          text: '{ "prop": "bar" }',
        },
      }),
    );
  });
});
